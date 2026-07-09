import type { PendingDraft, PendingDraftInput } from "./types";
import { makeLocalId } from "./localIds";

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface PendingQueueStore {
  listPendingDrafts(): Promise<PendingDraft[]>;
  createPendingDraft(input: PendingDraftInput): Promise<PendingDraft>;
  updatePendingDraftBody(id: string, body: string): Promise<PendingDraft>;
  deletePendingDraft(id: string): Promise<void>;
}

export function toPendingDraft(input: PendingDraftInput, now = Date.now()): PendingDraft {
  return {
    id: makeLocalId("draft", now),
    ...input,
    createdAt: now,
    updatedAt: now,
  };
}

export class TauriPendingQueueStore implements PendingQueueStore {
  private readonly invoke: TauriInvoke;

  constructor(invoke = window.__TAURI__?.core?.invoke) {
    if (!invoke) throw new Error("Tauri invoke API is unavailable");
    this.invoke = invoke;
  }

  listPendingDrafts(): Promise<PendingDraft[]> {
    return this.invoke("list_pending_drafts");
  }

  createPendingDraft(input: PendingDraftInput): Promise<PendingDraft> {
    return this.invoke("create_pending_draft", { input });
  }

  updatePendingDraftBody(id: string, body: string): Promise<PendingDraft> {
    return this.invoke("update_pending_draft_body", { id, body });
  }

  async deletePendingDraft(id: string): Promise<void> {
    await this.invoke("delete_pending_draft", { id });
  }
}

export class MemoryPendingQueueStore implements PendingQueueStore {
  private drafts = new Map<string, PendingDraft>();

  async listPendingDrafts(): Promise<PendingDraft[]> {
    return [...this.drafts.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async createPendingDraft(input: PendingDraftInput): Promise<PendingDraft> {
    const draft = toPendingDraft(input);
    this.drafts.set(draft.id, draft);
    return draft;
  }

  async updatePendingDraftBody(id: string, body: string): Promise<PendingDraft> {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error("Pending draft not found");
    const updated = { ...draft, body, updatedAt: Date.now() };
    this.drafts.set(id, updated);
    return updated;
  }

  async deletePendingDraft(id: string): Promise<void> {
    this.drafts.delete(id);
  }
}
