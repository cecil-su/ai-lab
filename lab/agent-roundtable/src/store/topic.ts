import fs from "node:fs";
import path from "node:path";
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
  sessionRef: string | null;
  tokens: { input: number; output: number };
}

export interface Topic {
  version: 1;
  id: string;
  title: string;
  mode: TopicMode;
  status: TopicStatus;
  maxRounds: number;
  currentRound: number;
  createdAt: string;
  participants: Participant[];
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
}

const TOPIC_FILE = "topic.json";

export function createTopic(root: string, input: CreateTopicInput): Topic {
  const dir = path.join(root, input.id);
  if (fs.existsSync(path.join(dir, TOPIC_FILE))) {
    throw new Error(`topic already exists: ${input.id}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const topic: Topic = {
    version: 1,
    id: input.id,
    title: input.title,
    mode: input.mode,
    status: "active",
    maxRounds: input.maxRounds,
    currentRound: 0,
    createdAt: new Date().toISOString(),
    participants: input.participants.map((p) => ({
      handle: p.handle,
      provider: p.provider,
      transport: "local",
      perspective: p.perspective,
      model: p.model ?? null,
      sessionRef: null,
      tokens: { input: 0, output: 0 },
    })),
  };
  writeJsonAtomic(path.join(dir, TOPIC_FILE), topic);
  return topic;
}

export function loadTopic(dir: string): Topic {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, TOPIC_FILE), "utf8")) as Topic;
  if (raw.version !== 1) {
    throw new Error(`unsupported topic.json version: ${String(raw.version)}`);
  }
  return raw;
}

export function saveTopic(dir: string, topic: Topic): void {
  writeJsonAtomic(path.join(dir, TOPIC_FILE), topic);
}

const TRANSITIONS: Record<TopicStatus, TopicStatus[]> = {
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: [],
};

export function transition(topic: Topic, next: TopicStatus): Topic {
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
