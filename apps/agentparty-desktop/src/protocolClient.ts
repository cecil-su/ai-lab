import type {
  ChannelEvent,
  ChannelHistoryResponse,
  ChannelMessage,
  PostMessageRequest,
  ServerProfile,
  WebSocketFrame,
} from "./types";

export interface ProtocolClient {
  loadHistory(profile: ServerProfile, token: string, afterSequence?: number): Promise<ChannelHistoryResponse>;
  postMessage(profile: ServerProfile, token: string, request: PostMessageRequest): Promise<ChannelMessage>;
  watchChannel(profile: ServerProfile, token: string, onEvent: (event: ChannelEvent) => void, onDisconnect: () => void): ChannelSubscription;
}

export type ChannelSubscription = {
  close(): void;
};

export class HttpProtocolClient implements ProtocolClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly webSocketFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  async loadHistory(profile: ServerProfile, token: string, afterSequence?: number): Promise<ChannelHistoryResponse> {
    const url = apiUrl(profile, `/api/channels/${encodeURIComponent(profile.channelId)}/events`);
    if (afterSequence !== undefined) url.searchParams.set("after_sequence", String(afterSequence));
    return this.request(url, token);
  }

  async postMessage(profile: ServerProfile, token: string, request: PostMessageRequest): Promise<ChannelMessage> {
    const url = apiUrl(profile, `/api/channels/${encodeURIComponent(profile.channelId)}/messages`);
    return this.request<ChannelMessage>(url, token, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  watchChannel(profile: ServerProfile, token: string, onEvent: (event: ChannelEvent) => void, onDisconnect: () => void): ChannelSubscription {
    const url = apiUrl(profile, `/api/channels/${encodeURIComponent(profile.channelId)}/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    const socket = this.webSocketFactory(url.toString());

    socket.addEventListener("message", (message) => {
      const frame = JSON.parse(String(message.data)) as WebSocketFrame;
      if (frame.type === "Message" || frame.type === "Status" || frame.type === "Presence") {
        onEvent({ type: frame.type, payload: frame.payload } as ChannelEvent);
      }
    });
    socket.addEventListener("close", onDisconnect);
    socket.addEventListener("error", onDisconnect);

    return { close: () => socket.close() };
  }

  private async request<T>(url: URL, token: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`AgentParty request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

function apiUrl(profile: ServerProfile, path: string): URL {
  const base = new URL(profile.serverUrl);
  base.pathname = path;
  base.search = "";
  return base;
}
