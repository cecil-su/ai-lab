import type { ChannelEvent, ChannelMessage, LocalAgentConfig, ParticipantStatusState, RunnerContext, RunnerResult, ServerProfile } from "./types";
import type { ChannelSubscription, ProtocolClient } from "./protocolClient";
import type { RunnerService } from "./runnerService";
import type { PendingQueueStore } from "./pendingQueueStore";
import { findWritableWorkdirConflict } from "./agentConfigStore";

export type RelayState = "stopped" | "starting" | "running";

export type LocalRelaySnapshot = {
  state: RelayState;
  processedMessageIds: string[];
  lastResult: RunnerResult | null;
  error: string | null;
};

const PROTOCOL_REMINDER =
  "Reply only to the triggering message. Do not post directly to the channel; return a draft RunnerResult for human review.";

export class LocalRelay {
  private subscription: ChannelSubscription | null = null;
  private startSequence = 0;
  private profile: ServerProfile | null = null;
  private token: string | null = null;
  private config: LocalAgentConfig | null = null;
  private recentMessages: ChannelMessage[] = [];
  private processedMessageIds = new Set<string>();
  private snapshot: LocalRelaySnapshot = {
    state: "stopped",
    processedMessageIds: [],
    lastResult: null,
    error: null,
  };

  constructor(
    private readonly protocol: ProtocolClient,
    private readonly runner: RunnerService,
    private readonly pendingQueue?: PendingQueueStore,
    private readonly notify: (snapshot: LocalRelaySnapshot) => void = () => {},
  ) {}

  getSnapshot(): LocalRelaySnapshot {
    return {
      ...this.snapshot,
      processedMessageIds: [...this.snapshot.processedMessageIds],
    };
  }

  async start(input: {
    profile: ServerProfile;
    token: string;
    config: LocalAgentConfig;
    knownConfigs?: LocalAgentConfig[];
    recentMessages: ChannelMessage[];
    lastSequence: number;
  }): Promise<void> {
    if (input.config.channelId !== input.profile.channelId) {
      throw new Error("Local agent config is bound to a different channel");
    }
    const conflict = findWritableWorkdirConflict(input.config, input.knownConfigs ?? [input.config]);
    if (conflict) {
      throw new Error(`Writable workdir conflict with ${conflict.name}: ${input.config.workdir}`);
    }
    this.stop(false);
    this.profile = input.profile;
    this.token = input.token;
    this.config = input.config;
    this.recentMessages = input.recentMessages;
    this.startSequence = input.lastSequence;
    this.set({ state: "starting", error: null });
    await this.protocol.postStatus(input.profile, input.token, { state: "waiting", scope: null });
    this.subscription = this.protocol.watchChannel(
      input.profile,
      input.token,
      (event) => void this.handleEvent(event),
      () => this.set({ state: "stopped" }),
    );
    this.set({ state: "running" });
  }

  async stop(advertise = true): Promise<void> {
    const profile = this.profile;
    const token = this.token;
    this.subscription?.close();
    this.subscription = null;
    this.profile = null;
    this.token = null;
    this.config = null;
    this.startSequence = 0;
    if (advertise && profile && token) {
      await this.protocol.postStatus(profile, token, { state: "done", scope: null });
    }
    this.set({ state: "stopped" });
  }

  async postStatus(state: ParticipantStatusState, scope?: string): Promise<void> {
    if (!this.profile || !this.token) return;
    await this.protocol.postStatus(this.profile, this.token, {
      state,
      scope: scope?.trim() || null,
    });
  }

  async handleEvent(event: ChannelEvent): Promise<void> {
    if (event.type !== "Message") return;
    await this.handleMessage(event.payload);
  }

  private async handleMessage(message: ChannelMessage): Promise<void> {
    if (!this.config) return;
    this.remember(message);
    if (message.sequence <= this.startSequence) return;
    if (this.processedMessageIds.has(message.id)) return;
    if (message.sender.owner_label === this.config.name) return;
    if (!message.mentions.includes(this.config.name)) return;

    const context = buildRunnerContext(this.config, message, this.recentMessages);
    try {
      const result = await this.runner.runRunner(this.config, context);
      await this.handleRunnerResult(message, result);
      this.processedMessageIds.add(message.id);
      this.set({
        processedMessageIds: [...this.processedMessageIds],
        lastResult: result,
        error: null,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.createBlockedPendingItem(message, messageText);
      this.set({ error: messageText });
    }
  }

  private async handleRunnerResult(message: ChannelMessage, result: RunnerResult): Promise<void> {
    if (!this.config || !this.profile || !this.token) return;
    if (result.status === "done" && this.config.sendingPolicy === "auto-send") {
      await this.protocol.postMessage(this.profile, this.token, {
        body: result.draftReply,
        mentions: [],
        reply_to_message_id: message.id,
      });
      return;
    }

    await this.pendingQueue?.createPendingDraft({
      profileId: this.profile.id,
      serverUrl: this.profile.serverUrl,
      channelId: this.profile.channelId,
      agentConfigId: this.config.id,
      agentName: this.config.name,
      triggeringMessageId: message.id,
      body: result.draftReply,
      status: result.status === "done" ? "pending" : "blocked",
      error: result.status === "done" ? null : result.stderr || "Runner blocked",
      runnerResult: result,
    });
  }

  private async createBlockedPendingItem(message: ChannelMessage, error: string): Promise<void> {
    if (!this.config || !this.profile) return;
    await this.pendingQueue?.createPendingDraft({
      profileId: this.profile.id,
      serverUrl: this.profile.serverUrl,
      channelId: this.profile.channelId,
      agentConfigId: this.config.id,
      agentName: this.config.name,
      triggeringMessageId: message.id,
      body: "",
      status: "blocked",
      error,
      runnerResult: null,
    });
  }

  private remember(message: ChannelMessage): void {
    this.recentMessages = [...this.recentMessages.filter((item) => item.id !== message.id), message]
      .sort((a, b) => a.sequence - b.sequence)
      .slice(-20);
  }

  private set(patch: Partial<LocalRelaySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify(this.getSnapshot());
  }
}

export function buildRunnerContext(
  config: LocalAgentConfig,
  triggeringMessage: ChannelMessage,
  recentMessages: ChannelMessage[],
): RunnerContext {
  return {
    channel: {
      id: config.channelId,
    },
    triggeringMessage,
    sender: triggeringMessage.sender,
    replyTarget: triggeringMessage.reply_to_message_id
      ? recentMessages.find((message) => message.id === triggeringMessage.reply_to_message_id) ?? null
      : null,
    mentions: triggeringMessage.mentions,
    recentMessages: recentMessages.filter((message) => message.id !== triggeringMessage.id).slice(-10),
    protocolReminder: PROTOCOL_REMINDER,
  };
}
