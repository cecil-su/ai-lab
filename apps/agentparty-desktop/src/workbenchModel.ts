import type { ChannelEvent, ChannelMessage, PostMessageRequest, ServerProfile } from "./types";
import type { ChannelSubscription, ProtocolClient } from "./protocolClient";
import type { ProfileStore } from "./profileStore";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export type WorkbenchSnapshot = {
  connectionState: ConnectionState;
  profile: ServerProfile | null;
  messages: ChannelMessage[];
  selectedReplyTo: ChannelMessage | null;
  lastSequence: number;
  error: string | null;
};

export class WorkbenchModel {
  private token: string | null = null;
  private subscription: ChannelSubscription | null = null;
  private snapshot: WorkbenchSnapshot = {
    connectionState: "disconnected",
    profile: null,
    messages: [],
    selectedReplyTo: null,
    lastSequence: 0,
    error: null,
  };

  constructor(
    private readonly profiles: ProfileStore,
    private readonly protocol: ProtocolClient,
    private readonly notify: (snapshot: WorkbenchSnapshot) => void = () => {},
  ) {}

  getSnapshot(): WorkbenchSnapshot {
    return { ...this.snapshot, messages: [...this.snapshot.messages] };
  }

  async connect(profile: ServerProfile): Promise<void> {
    this.disconnect(false);
    this.set({ connectionState: "connecting", profile, error: null });
    try {
      this.token = await this.profiles.getToken(profile.id);
      const history = await this.protocol.loadHistory(profile, this.token);
      this.applyEvents(history.events);
      this.set({ lastSequence: history.last_sequence, connectionState: "connected" });
      this.subscription = this.protocol.watchChannel(
        profile,
        this.token,
        (event) => this.receive(event),
        () => this.disconnect(true),
      );
    } catch (error) {
      this.set({ connectionState: "disconnected", error: errorMessage(error) });
    }
  }

  disconnect(keepHistory = true): void {
    this.subscription?.close();
    this.subscription = null;
    this.token = null;
    this.set({
      connectionState: "disconnected",
      messages: keepHistory ? this.snapshot.messages : [],
      selectedReplyTo: keepHistory ? this.snapshot.selectedReplyTo : null,
    });
  }

  canSend(): boolean {
    return this.snapshot.connectionState === "connected" && !!this.snapshot.profile && !!this.token;
  }

  selectReplyTo(messageId: string | null): void {
    this.set({
      selectedReplyTo: this.snapshot.messages.find((message) => message.id === messageId) ?? null,
    });
  }

  async send(body: string, mentions: string[] = []): Promise<ChannelMessage> {
    if (!this.canSend() || !this.snapshot.profile || !this.token) {
      throw new Error("Cannot send while disconnected");
    }
    const request: PostMessageRequest = {
      body,
      mentions,
      reply_to_message_id: this.snapshot.selectedReplyTo?.id ?? null,
    };
    const message = await this.protocol.postMessage(this.snapshot.profile, this.token, request);
    this.upsertMessage(message);
    this.set({ selectedReplyTo: null });
    return message;
  }

  async catchUp(): Promise<void> {
    if (!this.snapshot.profile) return;
    const token = await this.profiles.getToken(this.snapshot.profile.id);
    const history = await this.protocol.loadHistory(this.snapshot.profile, token, this.snapshot.lastSequence);
    this.applyEvents(history.events);
    this.set({ lastSequence: Math.max(this.snapshot.lastSequence, history.last_sequence) });
  }

  private receive(event: ChannelEvent): void {
    this.applyEvents([event]);
  }

  private applyEvents(events: ChannelEvent[]): void {
    for (const event of events) {
      if (event.type === "Message") {
        this.upsertMessage(event.payload);
      } else if ("sequence" in event.payload) {
        this.set({ lastSequence: Math.max(this.snapshot.lastSequence, event.payload.sequence) });
      }
    }
  }

  private upsertMessage(message: ChannelMessage): void {
    const messages = this.snapshot.messages.filter((item) => item.id !== message.id);
    messages.push(message);
    messages.sort((a, b) => a.sequence - b.sequence);
    this.set({ messages, lastSequence: Math.max(this.snapshot.lastSequence, message.sequence) });
  }

  private set(patch: Partial<WorkbenchSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.notify(this.getSnapshot());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
