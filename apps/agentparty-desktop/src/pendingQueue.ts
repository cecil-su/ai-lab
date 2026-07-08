import type { ProtocolClient } from "./protocolClient";
import type { ProfileStore } from "./profileStore";
import type { PendingDraft, PendingDraftInput, ServerProfile } from "./types";
import type { PendingQueueStore } from "./pendingQueueStore";

export class PendingQueue {
  constructor(
    private readonly store: PendingQueueStore,
    private readonly profiles: ProfileStore,
    private readonly protocol: ProtocolClient,
  ) {}

  list(): Promise<PendingDraft[]> {
    return this.store.listPendingDrafts();
  }

  create(input: PendingDraftInput): Promise<PendingDraft> {
    return this.store.createPendingDraft(input);
  }

  edit(id: string, body: string): Promise<PendingDraft> {
    return this.store.updatePendingDraftBody(id, body);
  }

  discard(id: string): Promise<void> {
    return this.store.deletePendingDraft(id);
  }

  async send(draft: PendingDraft): Promise<void> {
    if (draft.status !== "pending") {
      throw new Error("Only pending drafts can be sent");
    }
    const token = await this.profiles.getToken(draft.profileId);
    await this.protocol.postMessage(profileFromDraft(draft), token, {
      body: draft.body,
      mentions: [],
      reply_to_message_id: draft.triggeringMessageId,
    });
    await this.store.deletePendingDraft(draft.id);
  }
}

export function profileFromDraft(draft: PendingDraft): ServerProfile {
  return {
    id: draft.profileId,
    name: draft.agentName,
    serverUrl: draft.serverUrl,
    channelId: draft.channelId,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}
