import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeOutput } from "../src/adapters/claude.js";
import { parseCodexEvents } from "../src/adapters/codex.js";
import { parseOpencodeEvents } from "../src/adapters/opencode.js";
import { cleanReasonixStdout, reasonixSessionsDir } from "../src/adapters/reasonix.js";

// 样张均取自 2026-07-30 本机实测输出(claude 2.1.220 / codex 0.145.0 / opencode 1.18.9 / reasonix 1.8.0-rc.1)

describe("parseClaudeOutput", () => {
  const sample = JSON.stringify({
    is_error: false,
    session_id: "a0bb6e0a-6503-4ef8-aa77-73a4fa4b76e7",
    usage: { input_tokens: 2, cache_creation_input_tokens: 3907, cache_read_input_tokens: 0, output_tokens: 5 },
    subtype: "success",
    result: "PONG",
    type: "result",
  });

  it("extracts result / session_id / summed usage", () => {
    const r = parseClaudeOutput(sample);
    expect(r.text).toBe("PONG");
    expect(r.sessionRef).toBe("a0bb6e0a-6503-4ef8-aa77-73a4fa4b76e7");
    expect(r.tokens).toEqual({ input: 3909, output: 5 });
  });

  it("throws on is_error / non-success / invalid JSON", () => {
    expect(() => parseClaudeOutput(sample.replace('"is_error":false', '"is_error":true'))).toThrow(/claude 返回错误/);
    expect(() => parseClaudeOutput(sample.replace('"subtype":"success"', '"subtype":"error_during_execution"'))).toThrow(/claude 返回错误/);
    expect(() => parseClaudeOutput("not json")).toThrow(/不是合法 JSON/);
  });
});

describe("parseCodexEvents", () => {
  const lines = [
    '{"type":"thread.started","thread_id":"019fb097-b487-72b2-906c-d39206456bbe"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"草稿"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"PONG"}}',
    '{"type":"turn.completed","usage":{"input_tokens":14675,"cached_input_tokens":1920,"cache_write_input_tokens":0,"output_tokens":27,"reasoning_output_tokens":19}}',
  ];

  it("captures thread_id, last agent_message, summed usage; tolerates junk lines", () => {
    const r = parseCodexEvents(["banner text", ...lines].join("\n"));
    expect(r.sessionRef).toBe("019fb097-b487-72b2-906c-d39206456bbe");
    expect(r.text).toBe("PONG");
    expect(r.tokens).toEqual({ input: 16595, output: 27 });
  });

  it("falls back to -o file content when agent_message is missing", () => {
    const noMessage = [lines[0]!, lines[1]!, lines[4]!].join("\n");
    expect(parseCodexEvents(noMessage, "落盘正文\n").text).toBe("落盘正文");
    expect(() => parseCodexEvents(noMessage)).toThrow(/没有 agent_message/);
  });

  it("throws on missing thread_id or error event", () => {
    expect(() => parseCodexEvents(lines.slice(2).join("\n"))).toThrow(/thread_id/);
    expect(() => parseCodexEvents([...lines, '{"type":"error","message":"boom"}'].join("\n"))).toThrow(/boom/);
  });
});

describe("parseOpencodeEvents", () => {
  const sid = "ses_04f67838dffewWnQBra2MHaH5R";
  const ev = (o: object) => JSON.stringify(o);
  const sample = [
    ev({ type: "step_start", sessionID: sid, part: { id: "prt_1", type: "step-start" } }),
    ev({ type: "text", sessionID: sid, part: { id: "prt_2", type: "text", text: "第一段" } }),
    ev({ type: "text", sessionID: sid, part: { id: "prt_3", type: "text", text: "第二段" } }),
    ev({
      type: "step_finish",
      sessionID: sid,
      part: { id: "prt_4", type: "step-finish", tokens: { total: 10005, input: 9999, output: 6, reasoning: 0, cache: { write: 0, read: 100 } } },
    }),
  ].join("\n");

  it("captures sessionID, joins text parts, sums tokens", () => {
    const r = parseOpencodeEvents(sample);
    expect(r.sessionRef).toBe(sid);
    expect(r.text).toBe("第一段\n\n第二段");
    expect(r.tokens).toEqual({ input: 10099, output: 6 });
  });

  it("dedupes repeated part ids keeping the last text", () => {
    const dup = sample + "\n" + ev({ type: "text", sessionID: sid, part: { id: "prt_2", type: "text", text: "第一段(修订)" } });
    expect(parseOpencodeEvents(dup).text).toBe("第一段(修订)\n\n第二段");
  });

  it("throws when sessionID or text is missing", () => {
    expect(() => parseOpencodeEvents('{"type":"step_start"}')).toThrow(/sessionID/);
    expect(() => parseOpencodeEvents(ev({ type: "step_start", sessionID: sid, part: { type: "step-start" } }))).toThrow(/没有 text/);
  });
});

describe("cleanReasonixStdout", () => {
  it("strips thinking marker / codegraph notice / stats tail from real sample", () => {
    const sample = [
      "  · codegraph: preparing code-intelligence tools in the background — tools will appear when ready",
      "\x1b[2m  ▎ thinking\x1b[0m",
      "PONG",
      "  · 11325 tok · in 11303 (0 cached / 11303 new) · out 22 (19 reasoning)",
      "",
    ].join("\n");
    expect(cleanReasonixStdout(sample)).toBe("PONG");
  });

  it("keeps multi-line body including bullet-ish lines", () => {
    const sample = "第一行\n· 结论:保留这行\n第二行\n  · 11325 tok · in 1 · out 2\n";
    expect(cleanReasonixStdout(sample)).toBe("第一行\n· 结论:保留这行\n第二行");
  });
});

describe("reasonixSessionsDir", () => {
  it.runIf(process.platform === "win32")("maps cwd to %APPDATA% project sessions dir", () => {
    const dir = reasonixSessionsDir("C:\\Users\\me\\topics\\t1");
    expect(dir.endsWith(path.join("reasonix", "projects", "C--Users-me-topics-t1", "sessions"))).toBe(true);
  });
});
