import type { ServerProfile, ServerProfileInput } from "./types";
import { makeLocalId } from "./localIds";

export type ConnectionSecurity = "https" | "trusted-intranet-http";

export interface ProfileStore {
  listProfiles(): Promise<ServerProfile[]>;
  saveProfile(input: ServerProfileInput): Promise<ServerProfile>;
  getToken(profileId: string): Promise<string>;
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
  }
}

export function classifyServerUrl(rawUrl: string): ConnectionSecurity {
  const url = new URL(rawUrl);
  if (url.protocol === "https:") return "https";
  if (url.protocol === "http:") return "trusted-intranet-http";
  throw new Error("Server URL must use http or https");
}

export function normalizeServerUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http or https");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function toPersistedProfile(input: ServerProfileInput, now = Date.now()): ServerProfile {
  const id = input.id?.trim() || makeProfileId(now);
  return {
    id,
    name: input.name.trim(),
    serverUrl: normalizeServerUrl(input.serverUrl),
    channelId: input.channelId.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

function makeProfileId(now = Date.now()): string {
  return makeLocalId("profile", now);
}

export class TauriProfileStore implements ProfileStore {
  private readonly invoke: TauriInvoke;

  constructor(invoke = window.__TAURI__?.core?.invoke) {
    if (!invoke) {
      throw new Error("Tauri invoke API is unavailable");
    }
    this.invoke = invoke;
  }

  listProfiles(): Promise<ServerProfile[]> {
    return this.invoke("list_server_profiles");
  }

  saveProfile(input: ServerProfileInput): Promise<ServerProfile> {
    return this.invoke("save_server_profile", { input });
  }

  getToken(profileId: string): Promise<string> {
    return this.invoke("get_server_profile_token", { profileId });
  }
}

export class MemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, ServerProfile>();
  private tokens = new Map<string, string>();

  async listProfiles(): Promise<ServerProfile[]> {
    return [...this.profiles.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async saveProfile(input: ServerProfileInput): Promise<ServerProfile> {
    const previous = input.id ? this.profiles.get(input.id) : undefined;
    const now = Date.now();
    const profile = {
      ...toPersistedProfile(input, previous?.createdAt ?? now),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.profiles.set(profile.id, profile);
    this.tokens.set(profile.id, input.token);
    return profile;
  }

  async getToken(profileId: string): Promise<string> {
    const token = this.tokens.get(profileId);
    if (!token) throw new Error("Profile token is missing");
    return token;
  }
}
