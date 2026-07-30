import type { InboxEntry } from "../store/inbox.js";
import type { Topic } from "../store/topic.js";
import type { TranscriptEvent } from "../store/transcript.js";

// 可测的纯逻辑:事件→渲染行、pending 合并、状态栏数据、输入命令解析。TUI 组件只做绑定。

// 参与者着色调色板(避开 human 专用的 yellow 与 system/round_end 的 dim 灰)
const PALETTE = [
  "green",
  "cyan",
  "magenta",
  "blue",
  "greenBright",
  "cyanBright",
  "magentaBright",
  "blueBright",
] as const;

export interface RenderRow {
  key: string;
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/** 按首次出现顺序给发言者分配稳定颜色(超出调色板则回绕) */
export function colorMap(events: TranscriptEvent[]): Map<string, string> {
  const order: string[] = [];
  for (const e of events) {
    if (!e.from) continue;
    if (e.kind !== "message" && e.kind !== "skip" && e.kind !== "verdict") continue;
    if (!order.includes(e.from)) order.push(e.from);
  }
  const map = new Map<string, string>();
  order.forEach((handle, i) => map.set(handle, PALETTE[i % PALETTE.length]!));
  return map;
}

export function renderEvent(event: TranscriptEvent, colorOf: (handle?: string) => string | undefined): RenderRow {
  const r = event.round > 0 ? `[R${event.round}] ` : "";
  const key = `t${event.seq}`;
  switch (event.kind) {
    case "system":
      return { key, text: `* ${event.body ?? ""}`, dim: true };
    case "message":
      return { key, text: `${r}${event.from}: ${event.body ?? ""}`, color: colorOf(event.from) };
    case "human":
      return { key, text: `${r}${event.from}(插话): ${event.body ?? ""}`, color: "yellow", bold: true };
    case "skip":
      return { key, text: `${r}${event.from}: 【跳过】`, dim: true };
    case "verdict":
      return { key, text: `${r}${event.from}(裁决): ${event.body ?? ""}`, color: "cyanBright", bold: true };
    case "round_end":
      return { key, text: `${r}—— 本轮结束 ——`, dim: true };
  }
}

/** 未消费插话(attach 已写 inbox、runner 尚未搬入 transcript)显示为 pending 行 */
export function pendingRow(entry: InboxEntry): RenderRow {
  return { key: `p${entry.id}`, text: `${entry.from}(插话·待发送): ${entry.body ?? ""}`, color: "yellow", dim: true };
}

/** transcript 事件行 + 尾部 pending 插话行(runner 消费后 pending 自然消失、转正为 human 行) */
export function renderRows(events: TranscriptEvent[], pendingSays: InboxEntry[]): RenderRow[] {
  const colors = colorMap(events);
  const colorOf = (handle?: string): string | undefined => (handle ? colors.get(handle) : undefined);
  const rows = events.map((e) => renderEvent(e, colorOf));
  for (const entry of pendingSays) rows.push(pendingRow(entry));
  return rows;
}

export interface StatusView {
  title: string;
  mode: string;
  round: string;
  runner: string;
  tokens: number;
}

export function computeStatusBar(topic: Topic, lockAlive: boolean): StatusView {
  const tokens = topic.participants.reduce((sum, p) => sum + p.tokens.input + p.tokens.output, 0);
  const runner = lockAlive ? "运行中" : topic.status === "completed" ? "已完成" : "未运行";
  return {
    title: topic.title,
    mode: topic.mode,
    round: `${topic.currentRound}/${topic.maxRounds}`,
    runner,
    tokens,
  };
}

export type InputAction =
  | { type: "noop" }
  | { type: "quit" }
  | { type: "stop" }
  | { type: "say"; body: string };

/** 输入框回车语义:空→noop、:stop→控制事件、:q/:quit→退出视图、其余→human 插话 */
export function parseInput(raw: string): InputAction {
  const text = raw.trim();
  if (text === "") return { type: "noop" };
  if (text === ":stop") return { type: "stop" };
  if (text === ":q" || text === ":quit") return { type: "quit" };
  return { type: "say", body: text };
}
