// 模式收尾分派(design §4)。回合循环两模式共用(runner.ts);差异只在收尾:
//   roundtable → 末位参与者用既有会话输出总结
//   debate     → 中立裁决人(第一位参与者的 provider,全新无记忆会话)输出结构化裁决
// 仅两种模式,故用最小策略对象,不做插件框架(Simplicity First)。

import fs from "node:fs";
import path from "node:path";
import { providerBase } from "../adapters/registry.js";
import type { ProviderAdapter } from "../adapters/types.js";
import type { Topic, TopicMode } from "../store/topic.js";
import { appendEvent, readTranscript, type TranscriptEvent } from "../store/transcript.js";
import { resolvePerspectiveText } from "./charter.js";
import { buildPrompt, promptContext } from "./prompt.js";

const SUMMARY_FILE = "summary.md";

export interface FinaleContext {
  dir: string;
  charter: string;
  topic: Topic;
  adapters: Map<string, ProviderAdapter>;
  converged: boolean;
  timeoutMs: number;
  emit: (e: TranscriptEvent) => void;
}

export interface ModeStrategy {
  finalize(ctx: FinaleContext): Promise<Topic>;
}

const roundtable: ModeStrategy = {
  // 末位参与者(沿用其会话记忆)综合全部发言输出总结 → summary.md
  async finalize({ dir, charter, topic, adapters, converged, timeoutMs, emit }): Promise<Topic> {
    const summarizer = topic.participants[topic.participants.length - 1]!;
    const adapter = adapters.get(summarizer.handle)!;
    const ctx = promptContext(readTranscript(dir), topic.currentRound + 2, topic.resumeFromSeq ?? 0);
    const prompt =
      buildPrompt({
        charter,
        self: { handle: summarizer.handle, perspective: resolvePerspectiveText(summarizer.perspective) },
        round: topic.currentRound,
        maxRounds: topic.maxRounds,
        stanceSummary: ctx.stanceSummary,
        recent: ctx.recent,
      }) + "\n\n## 收尾任务\n讨论到此结束,请综合全部发言,输出:结论、各方立场摘要、主要分歧点。";

    const result = await adapter.speak({
      prompt,
      sessionRef: summarizer.sessionRef ?? undefined,
      model: summarizer.model ?? undefined,
      cwd: topic.repo ?? dir,
      codeAccess: !!topic.repo,
      timeoutMs,
    });

    const header = `# 讨论总结:${topic.title}\n\n> 模式 ${topic.mode} · 完成 ${topic.currentRound}/${topic.maxRounds} 轮${converged ? " · 已收敛" : ""}\n\n`;
    fs.writeFileSync(path.join(dir, SUMMARY_FILE), header + result.text.trim() + "\n");

    emit(appendEvent(dir, {
      kind: "system",
      round: topic.currentRound,
      body: `话题结束${converged ? "(已收敛)" : ""},已生成 summary.md`,
    }));

    const tokens = {
      input: summarizer.tokens.input + (result.tokens?.input ?? 0),
      cached: summarizer.tokens.cached + (result.tokens?.cached ?? 0),
      output: summarizer.tokens.output + (result.tokens?.output ?? 0),
    };
    return {
      ...topic,
      participants: topic.participants.map((p) =>
        p.handle === summarizer.handle ? { ...p, sessionRef: result.sessionRef, tokens } : p,
      ),
    };
  },
};

const VERDICT_TASK = [
  "",
  "",
  "## 裁决任务",
  "你是中立裁决人,未参与上述辩论,不站队。请基于全部论据输出结构化裁决,分四段:",
  "- **结论**:一句话给出裁决结果。",
  "- **关键论据**:支撑结论的核心理由。",
  "- **分歧点**:各方无法调和的争议所在。",
  "- **风险**:该结论落地的主要风险。",
].join("\n");

const debate: ModeStrategy = {
  // 裁决轮:第一位参与者的 provider 以「裁决人」身份、全新会话(sessionRef 空)裁决,避免立场污染。
  // 裁决发言写 verdict 事件并据此生成 summary.md。裁决人为临时身份,不并入任何参与者的 sessionRef/tokens。
  async finalize({ dir, charter, topic, adapters, converged, timeoutMs, emit }): Promise<Topic> {
    const first = topic.participants[0]!;
    const adapter = adapters.get(first.handle)!;
    const judgeHandle = `${providerBase(first.provider)}-judge`;
    const verdictRound = topic.currentRound + 1;

    // round+1:全部辩论轮压成立场摘要 + 最后一轮全文,喂给无记忆的裁决人
    const ctx = promptContext(readTranscript(dir), verdictRound, topic.resumeFromSeq ?? 0);
    const prompt =
      buildPrompt({
        charter,
        self: { handle: judgeHandle, perspective: "中立裁决人:不参与辩论、不站队,只基于全部论据裁决" },
        round: verdictRound,
        maxRounds: topic.maxRounds,
        stanceSummary: ctx.stanceSummary,
        recent: ctx.recent,
      }) + VERDICT_TASK;

    const result = await adapter.speak({
      prompt,
      sessionRef: undefined, // 全新会话,不继承立场方记忆
      model: first.model ?? undefined,
      cwd: topic.repo ?? dir,
      codeAccess: !!topic.repo,
      timeoutMs,
    });

    emit(appendEvent(dir, { kind: "verdict", round: verdictRound, from: judgeHandle, body: result.text }));

    const header = `# 裁决:${topic.title}\n\n> 模式 ${topic.mode} · 辩论 ${topic.currentRound}/${topic.maxRounds} 轮${converged ? " · 已收敛" : ""} · 裁决人 ${judgeHandle}\n\n`;
    fs.writeFileSync(path.join(dir, SUMMARY_FILE), header + result.text.trim() + "\n");

    emit(appendEvent(dir, {
      kind: "system",
      round: verdictRound,
      body: `裁决完成${converged ? "(已收敛)" : ""},已生成 summary.md`,
    }));

    return topic;
  },
};

const STRATEGIES: Record<TopicMode, ModeStrategy> = { roundtable, debate };

export function selectMode(mode: TopicMode): ModeStrategy {
  return STRATEGIES[mode];
}
