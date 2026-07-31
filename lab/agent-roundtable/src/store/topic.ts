import fs from "node:fs";
import path from "node:path";
import { providerBase } from "../adapters/registry.js";
import type { SessionRef } from "../adapters/types.js";
import { fromLegacy } from "../engine/session-trust.js";
import { writeJsonAtomic } from "./jsonl.js";

export type TopicMode = "roundtable" | "debate";
export type TopicStatus = "active" | "paused" | "completed";
export type Perspective = string | { custom: string };

export interface Participant {
  handle: string;
  provider: string;
  transport: "local";
  perspective: Perspective;
  model: string | null;
  sessionRef: SessionRef | null;
  tokens: { input: number; cached: number; output: number };
  /** 累计失败次数(A1);>0 时计量为下界(失败调用的 token 无法计入) */
  failures: number;
}

export interface Topic {
  version: 2;
  id: string;
  title: string;
  mode: TopicMode;
  status: TopicStatus;
  maxRounds: number;
  currentRound: number;
  createdAt: string;
  participants: Participant[];
  /** 自读(R2):参与者发言时的代码仓库 cwd(绝对路径);缺省 = 话题目录、无代码接触 */
  repo?: string;
  /** 续谈水位线(F9):重开时置为当时 lastSeq,prompt 事件下界,挡旧裁决/旧收尾回流 */
  resumeFromSeq?: number;
  /**
   * ③ 收尾代际标记(ADR 0030):把"收尾是否完成"从散落多文件收敛到一处显式状态,
   * 使 finalize 崩溃可幂等恢复。缺省 = 从未进入收尾。generation 每次进入收尾自增(续谈按代)。
   */
  finalization?: { generation: number; phase: "pending" | "summary-written" | "done" };
}

export interface ParticipantInput {
  handle: string;
  provider: string;
  perspective: Perspective;
  model?: string;
}

export interface CreateTopicInput {
  id: string;
  title: string;
  mode: TopicMode;
  maxRounds: number;
  participants: ParticipantInput[];
  repo?: string;
}

const TOPIC_FILE = "topic.json";

export function createTopic(root: string, input: CreateTopicInput): Topic {
  const dir = path.join(root, input.id);
  if (fs.existsSync(path.join(dir, TOPIC_FILE))) {
    throw new Error(`topic already exists: ${input.id}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const topic: Topic = {
    version: 2,
    id: input.id,
    title: input.title,
    mode: input.mode,
    status: "active",
    maxRounds: input.maxRounds,
    currentRound: 0,
    createdAt: new Date().toISOString(),
    ...(input.repo ? { repo: input.repo } : {}),
    participants: input.participants.map((p) => ({
      handle: p.handle,
      provider: p.provider,
      transport: "local",
      perspective: p.perspective,
      model: p.model ?? null,
      sessionRef: null,
      tokens: { input: 0, cached: 0, output: 0 },
      failures: 0,
    })),
  };
  writeJsonAtomic(path.join(dir, TOPIC_FILE), topic);
  return topic;
}

export function loadTopic(dir: string): Topic {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, TOPIC_FILE), "utf8")) as Topic;
  const version = (raw as { version: number }).version;
  if (version !== 1 && version !== 2) {
    throw new Error(`unsupported topic.json version: ${String(version)}`);
  }
  // 向后兼容读:旧话题缺 tokens.cached / failures → 默认 0
  for (const p of raw.participants) {
    if (p.tokens.cached === undefined) p.tokens = { ...p.tokens, cached: 0 };
    if (p.failures === undefined) p.failures = 0;
    // ADR 0032:v1 的裸字符串 sessionRef → 结构化 SessionRef(按 provider base 归属;@last→degraded)
    const legacyRef = (p as { sessionRef: SessionRef | string | null }).sessionRef;
    if (typeof legacyRef === "string") {
      p.sessionRef = fromLegacy(providerBase(p.provider), legacyRef);
    }
  }
  raw.version = 2; // 惰性升级,下次 saveTopic 落 v2
  return raw;
}

export function saveTopic(dir: string, topic: Topic): void {
  writeJsonAtomic(path.join(dir, TOPIC_FILE), topic);
}

const TRANSITIONS: Record<TopicStatus, TopicStatus[]> = {
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: ["active"], // 续谈重开(F2):completed → active 合法化
};

export function transition(topic: Topic, next: TopicStatus): Topic {
  if (next === topic.status) return topic; // 幂等:同态重设为 no-op
  if (!TRANSITIONS[topic.status].includes(next)) {
    throw new Error(`invalid status transition: ${topic.status} -> ${next}`);
  }
  return { ...topic, status: next };
}

export function listTopics(root: string): Topic[] {
  if (!fs.existsSync(root)) return [];
  const topics: Topic[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (!fs.existsSync(path.join(dir, TOPIC_FILE))) continue;
    topics.push(loadTopic(dir));
  }
  return topics;
}
