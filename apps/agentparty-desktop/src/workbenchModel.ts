import type { ChannelEvent, ChannelMessage, PostMessageRequest, PresenceUpdate, ServerProfile, StatusUpdate } from "./types";
import type { ChannelSubscription, ProtocolClient } from "./protocolClient";
import type { ProfileStore } from "./profileStore";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export type ChannelWorkbenchSnapshot = {
  profile: ServerProfile;
  connectionState: ConnectionState;
  messages: ChannelMessage[];
  selectedReplyTo: ChannelMessage | null;
  composerBody: string;
  composerMentions: string;
  presence: PresenceUpdate[];
  statuses: StatusUpdate[];
  lastSequence: number;
  error: string | null;
  unreadCount: number;
};

export type WorkbenchSnapshot = {
  connectionState: ConnectionState;
  profile: ServerProfile | null;
  messages: ChannelMessage[];
  selectedReplyTo: ChannelMessage | null;
  composerBody: string;
  composerMentions: string;
  presence: PresenceUpdate[];
  statuses: StatusUpdate[];
  lastSequence: number;
  error: string | null;
  activeProfileId: string | null;
  channels: ChannelWorkbenchSnapshot[];
};

type ChannelState = ChannelWorkbenchSnapshot & {
  token: string | null;
  subscription: ChannelSubscription | null;
};

const EMPTY_ACTIVE_SNAPSHOT = {
  connectionState: "disconnected" as const,
  profile: null,
  messages: [],
  selectedReplyTo: null,
  composerBody: "",
  composerMentions: "",
  presence: [],
  statuses: [],
  lastSequence: 0,
  error: null,
};

export class WorkbenchModel {
  private activeProfileId: string | null = null;
  private channels = new Map<string, ChannelState>();
  private snapshot: WorkbenchSnapshot = {
    ...EMPTY_ACTIVE_SNAPSHOT,
    activeProfileId: null,
    channels: [],
  };

  constructor(
    private readonly profiles: ProfileStore,
    private readonly protocol: ProtocolClient,
    private readonly notify: (snapshot: WorkbenchSnapshot) => void = () => {},
  ) {}

  getSnapshot(): WorkbenchSnapshot {
    return {
      ...this.snapshot,
      messages: [...this.snapshot.messages],
      channels: this.snapshot.channels.map(copyChannelSnapshot),
    };
  }

  async connect(profile: ServerProfile): Promise<void> {
    const existing = this.channels.get(profile.id);
    if (existing?.connectionState === "connected") {
      this.switchChannel(profile.id);
      return;
    }

    this.activeProfileId = profile.id;
    this.setChannel(profile.id, makeChannelState(profile, existing, { connectionState: "connecting", error: null, unreadCount: 0 }));
    try {
      const token = await this.profiles.getToken(profile.id);
      const history = await this.protocol.loadHistory(profile, token, existing?.lastSequence || undefined);
      this.applyEvents(profile.id, history.events, false);
      const state = this.requireChannel(profile.id);
      state.token = token;
      state.subscription = this.protocol.watchChannel(
        profile,
        token,
        (event) => this.receive(profile.id, event),
        () => this.disconnect(true, profile.id),
      );
      this.setChannel(profile.id, { ...state, lastSequence: Math.max(state.lastSequence, history.last_sequence), connectionState: "connected", error: null, unreadCount: 0 });
    } catch (error) {
      const state = this.requireChannel(profile.id);
      this.setChannel(profile.id, { ...state, connectionState: "disconnected", error: errorMessage(error) });
    }
  }

  switchChannel(profileId: string): void {
    const state = this.channels.get(profileId);
    if (!state) return;
    this.activeProfileId = profileId;
    this.setChannel(profileId, { ...state, unreadCount: 0 });
  }

  disconnect(keepHistory = true, profileId = this.activeProfileId): void {
    if (!profileId) return;
    const state = this.channels.get(profileId);
    if (!state) return;
    state.subscription?.close();
    this.setChannel(profileId, {
      ...state,
      token: null,
      subscription: null,
      connectionState: "disconnected",
      messages: keepHistory ? state.messages : [],
      selectedReplyTo: keepHistory ? state.selectedReplyTo : null,
    });
  }

  canSend(): boolean {
    const state = this.activeChannel();
    return state?.connectionState === "connected" && !!state.token;
  }

  updateComposerDraft(patch: Partial<Pick<ChannelWorkbenchSnapshot, "composerBody" | "composerMentions">>): void {
    const state = this.activeChannel();
    if (!state) return;
    this.setChannel(state.profile.id, { ...state, ...patch });
  }

  selectReplyTo(messageId: string | null): void {
    const state = this.activeChannel();
    if (!state) return;
    this.setChannel(state.profile.id, {
      ...state,
      selectedReplyTo: state.messages.find((message) => message.id === messageId) ?? null,
    });
  }

  async send(body: string, mentions: string[] = []): Promise<ChannelMessage> {
    const state = this.activeChannel();
    if (!this.canSend() || !state?.token) {
      throw new Error("Cannot send while disconnected");
    }
    const request: PostMessageRequest = {
      body,
      mentions,
      reply_to_message_id: state.selectedReplyTo?.id ?? null,
    };
    const message = await this.protocol.postMessage(state.profile, state.token, request);
    this.upsertMessage(state.profile.id, message);
    this.setChannel(state.profile.id, {
      ...this.requireChannel(state.profile.id),
      selectedReplyTo: null,
      composerBody: "",
    });
    return message;
  }

  async catchUp(profileId = this.activeProfileId): Promise<void> {
    if (!profileId) return;
    const state = this.channels.get(profileId);
    if (!state) return;
    const token = state.token ?? (await this.profiles.getToken(profileId));
    const history = await this.protocol.loadHistory(state.profile, token, state.lastSequence);
    this.applyEvents(profileId, history.events, false);
    const next = this.requireChannel(profileId);
    this.setChannel(profileId, { ...next, lastSequence: Math.max(next.lastSequence, history.last_sequence) });
  }

  private receive(profileId: string, event: ChannelEvent): void {
    this.applyEvents(profileId, [event], true);
  }

  private applyEvents(profileId: string, events: ChannelEvent[], countUnread: boolean): void {
    for (const event of events) {
      if (event.type === "Message") {
        this.upsertMessage(profileId, event.payload, countUnread);
      } else if (event.type === "Presence") {
        this.upsertPresence(profileId, event.payload);
      } else if (event.type === "Status") {
        this.upsertStatus(profileId, event.payload);
      }
    }
  }

  private upsertMessage(profileId: string, message: ChannelMessage, countUnread = false): void {
    const state = this.requireChannel(profileId);
    const wasKnown = state.messages.some((item) => item.id === message.id);
    const messages = state.messages.filter((item) => item.id !== message.id);
    messages.push(message);
    messages.sort((a, b) => a.sequence - b.sequence);
    const isUnread = countUnread && profileId !== this.activeProfileId && !wasKnown;
    this.setChannel(profileId, {
      ...state,
      messages,
      lastSequence: Math.max(state.lastSequence, message.sequence),
      unreadCount: state.unreadCount + (isUnread ? 1 : 0),
    });
  }

  private activeChannel(): ChannelState | null {
    return this.activeProfileId ? this.channels.get(this.activeProfileId) ?? null : null;
  }

  private upsertPresence(profileId: string, presence: PresenceUpdate): void {
    const state = this.requireChannel(profileId);
    const nextPresence = state.presence.filter((item) => item.participant.id !== presence.participant.id);
    nextPresence.push(presence);
    nextPresence.sort((a, b) => a.participant.owner_label.localeCompare(b.participant.owner_label));
    this.setChannel(profileId, { ...state, presence: nextPresence });
  }

  private upsertStatus(profileId: string, status: StatusUpdate): void {
    const state = this.requireChannel(profileId);
    const statuses = state.statuses.filter((item) => item.participant.id !== status.participant.id);
    statuses.push(status);
    statuses.sort((a, b) => a.participant.owner_label.localeCompare(b.participant.owner_label));
    this.setChannel(profileId, {
      ...state,
      statuses,
      lastSequence: Math.max(state.lastSequence, status.sequence),
    });
  }

  private requireChannel(profileId: string): ChannelState {
    const state = this.channels.get(profileId);
    if (!state) throw new Error("Workbench channel is not loaded");
    return state;
  }

  private setChannel(profileId: string, state: ChannelState): void {
    this.channels.set(profileId, state);
    this.syncSnapshot();
  }

  private syncSnapshot(): void {
    const active = this.activeChannel();
    this.snapshot = {
      ...(active ? channelToActiveSnapshot(active) : EMPTY_ACTIVE_SNAPSHOT),
      activeProfileId: this.activeProfileId,
      channels: [...this.channels.values()].map(copyChannelSnapshot),
    };
    this.notify(this.getSnapshot());
  }
}

function makeChannelState(
  profile: ServerProfile,
  previous: ChannelState | undefined,
  patch: Partial<ChannelState>,
): ChannelState {
  return {
    profile,
    connectionState: previous?.connectionState ?? "disconnected",
    messages: previous?.messages ?? [],
    selectedReplyTo: previous?.selectedReplyTo ?? null,
    composerBody: previous?.composerBody ?? "",
    composerMentions: previous?.composerMentions ?? "",
    presence: previous?.presence ?? [],
    statuses: previous?.statuses ?? [],
    lastSequence: previous?.lastSequence ?? 0,
    error: previous?.error ?? null,
    unreadCount: previous?.unreadCount ?? 0,
    token: previous?.token ?? null,
    subscription: previous?.subscription ?? null,
    ...patch,
  };
}

function channelToActiveSnapshot(channel: ChannelWorkbenchSnapshot) {
  return {
    connectionState: channel.connectionState,
    profile: channel.profile,
    messages: [...channel.messages],
    selectedReplyTo: channel.selectedReplyTo,
    composerBody: channel.composerBody,
    composerMentions: channel.composerMentions,
    presence: [...channel.presence],
    statuses: [...channel.statuses],
    lastSequence: channel.lastSequence,
    error: channel.error,
  };
}

function copyChannelSnapshot(channel: ChannelWorkbenchSnapshot): ChannelWorkbenchSnapshot {
  return {
    profile: channel.profile,
    connectionState: channel.connectionState,
    messages: [...channel.messages],
    selectedReplyTo: channel.selectedReplyTo,
    composerBody: channel.composerBody,
    composerMentions: channel.composerMentions,
    presence: [...channel.presence],
    statuses: [...channel.statuses],
    lastSequence: channel.lastSequence,
    error: channel.error,
    unreadCount: channel.unreadCount,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
