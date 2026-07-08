import type {
  ChannelHistoryResponse as ContractChannelHistoryResponse,
  ChannelLoopGuard as ContractChannelLoopGuard,
  ChannelResponse as ContractChannelResponse,
} from "../../agentparty-main-service/protocol/agentparty-contract";

export type ChannelMode = "normal" | "party";
export type TokenKind = "human" | "agent";
export type ParticipantStatusState = "waiting" | "working" | "blocked" | "done";
export type PresenceState = "online" | "offline";

export type TokenMetadata = {
  id: string;
  kind: TokenKind;
  owner_label: string;
  created_at: number;
  revoked_at: number | null;
};

export type ChannelResponse = ContractChannelResponse;
export type ChannelLoopGuard = ContractChannelLoopGuard;

export type PostMessageRequest = {
  body: string;
  mentions: string[];
  reply_to_message_id: string | null;
};

export type PostStatusRequest = {
  state: ParticipantStatusState;
  scope: string | null;
};

export type ChannelHistoryResponse = ContractChannelHistoryResponse;

export type ChannelEvent =
  | { type: "Message"; payload: ChannelMessage }
  | { type: "Status"; payload: StatusUpdate }
  | { type: "Presence"; payload: PresenceUpdate };

export type ChannelMessage = {
  id: string;
  channel_id: string;
  sequence: number;
  sender: TokenMetadata;
  body: string;
  mentions: string[];
  reply_to_message_id: string | null;
  created_at: number;
};

export type StatusUpdate = {
  channel_id: string;
  sequence: number;
  participant: TokenMetadata;
  state: ParticipantStatusState;
  scope: string | null;
  created_at: number;
};

export type PresenceUpdate = {
  channel_id: string;
  participant: TokenMetadata;
  state: PresenceState;
};

export type WebSocketFrame =
  | { type: "Welcome"; payload: { channel: ChannelResponse; self_token: TokenMetadata; participants: PresenceUpdate[]; last_sequence: number; protocol_version: number } }
  | { type: "Message"; payload: ChannelMessage }
  | { type: "Status"; payload: StatusUpdate }
  | { type: "Presence"; payload: PresenceUpdate }
  | { type: "Sent"; payload: { channel_id: string; sequence: number } }
  | { type: "Error"; payload: { code: string; message: string } };

export type ServerProfile = {
  id: string;
  name: string;
  serverUrl: string;
  channelId: string;
  createdAt: number;
  updatedAt: number;
};

export type ServerProfileInput = {
  id?: string;
  name: string;
  serverUrl: string;
  channelId: string;
  token: string;
};

export type RunnerKind = "fake" | "codex" | "custom-command";
export type WorkdirMode = "read-only" | "writable";
export type SendingPolicy = "draft" | "auto-send";

export type LocalAgentConfig = {
  id: string;
  name: string;
  channelId: string;
  runnerKind: RunnerKind;
  customCommand: string | null;
  workdir: string;
  workdirMode: WorkdirMode;
  sendingPolicy: SendingPolicy;
  createdAt: number;
  updatedAt: number;
};

export type LocalAgentConfigInput = {
  id?: string;
  name: string;
  channelId: string;
  runnerKind: RunnerKind;
  customCommand: string | null;
  workdir: string;
  workdirMode: WorkdirMode;
  sendingPolicy: SendingPolicy;
};

export type RunnerContext = {
  channel: {
    id: string;
  };
  triggeringMessage: ChannelMessage;
  sender: TokenMetadata;
  replyTarget: ChannelMessage | null;
  mentions: string[];
  recentMessages: ChannelMessage[];
  protocolReminder: string;
};

export type RunnerResult = {
  status: "done" | "blocked";
  draftReply: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  contextFilePath: string;
};

export type RunnerLogEntry = RunnerResult & {
  id: string;
  agentConfigId: string;
  triggeringMessageId: string;
  createdAt: number;
};

export type PendingDraftStatus = "pending" | "blocked";

export type PendingDraft = {
  id: string;
  profileId: string;
  serverUrl: string;
  channelId: string;
  agentConfigId: string;
  agentName: string;
  triggeringMessageId: string;
  body: string;
  status: PendingDraftStatus;
  error: string | null;
  runnerResult: RunnerResult | null;
  createdAt: number;
  updatedAt: number;
};

export type PendingDraftInput = {
  profileId: string;
  serverUrl: string;
  channelId: string;
  agentConfigId: string;
  agentName: string;
  triggeringMessageId: string;
  body: string;
  status: PendingDraftStatus;
  error: string | null;
  runnerResult: RunnerResult | null;
};
