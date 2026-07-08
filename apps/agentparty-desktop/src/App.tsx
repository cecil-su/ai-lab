import { FormEvent, useEffect, useMemo, useState } from "react";
import { Lock, Plug, Reply, Send, ShieldAlert, ShieldCheck, Square, Bot, Play, Trash2, WifiOff } from "lucide-react";
import { MemoryAgentConfigStore, TauriAgentConfigStore } from "./agentConfigStore";
import { LocalRelay, type LocalRelaySnapshot } from "./localRelay";
import { PendingQueue } from "./pendingQueue";
import { MemoryPendingQueueStore, TauriPendingQueueStore } from "./pendingQueueStore";
import { HttpProtocolClient } from "./protocolClient";
import { classifyServerUrl, MemoryProfileStore, TauriProfileStore } from "./profileStore";
import { MemoryRunnerService, TauriRunnerService } from "./runnerService";
import type { ChannelMessage, LocalAgentConfig, LocalAgentConfigInput, PendingDraft, ServerProfile, ServerProfileInput } from "./types";
import { WorkbenchModel, type WorkbenchSnapshot } from "./workbenchModel";
import "./styles.css";

const fallbackStore = new MemoryProfileStore();
const fallbackAgentStore = new MemoryAgentConfigStore();
const fallbackRunner = new MemoryRunnerService();
const fallbackPendingQueueStore = new MemoryPendingQueueStore();

function createProfileStore() {
  try {
    return new TauriProfileStore();
  } catch {
    return fallbackStore;
  }
}

function createAgentConfigStore() {
  try {
    return new TauriAgentConfigStore();
  } catch {
    return fallbackAgentStore;
  }
}

function createRunnerService() {
  try {
    return new TauriRunnerService();
  } catch {
    return fallbackRunner;
  }
}

function createPendingQueueStore() {
  try {
    return new TauriPendingQueueStore();
  } catch {
    return fallbackPendingQueueStore;
  }
}

export function App() {
  const profileStore = useMemo(createProfileStore, []);
  const agentConfigStore = useMemo(createAgentConfigStore, []);
  const runnerService = useMemo(createRunnerService, []);
  const pendingQueueStore = useMemo(createPendingQueueStore, []);
  const protocol = useMemo(() => new HttpProtocolClient(), []);
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [agentConfigs, setAgentConfigs] = useState<LocalAgentConfig[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>({
    connectionState: "disconnected",
    profile: null,
    messages: [],
    selectedReplyTo: null,
    lastSequence: 0,
    error: null,
  });
  const [relaySnapshot, setRelaySnapshot] = useState<LocalRelaySnapshot>({
    state: "stopped",
    processedMessageIds: [],
    lastResult: null,
    error: null,
  });
  const model = useMemo(() => new WorkbenchModel(profileStore, protocol, setSnapshot), [profileStore, protocol]);
  const pendingQueue = useMemo(() => new PendingQueue(pendingQueueStore, profileStore, protocol), [pendingQueueStore, profileStore, protocol]);
  const relay = useMemo(() => new LocalRelay(protocol, runnerService, pendingQueueStore, setRelaySnapshot), [pendingQueueStore, protocol, runnerService]);

  useEffect(() => {
    void profileStore.listProfiles().then(setProfiles);
    void agentConfigStore.listAgentConfigs().then(setAgentConfigs);
    void pendingQueue.list().then(setPendingDrafts);
  }, [agentConfigStore, pendingQueue, profileStore]);

  useEffect(() => {
    void pendingQueue.list().then(setPendingDrafts);
  }, [pendingQueue, relaySnapshot.lastResult, relaySnapshot.error, relaySnapshot.processedMessageIds.length]);

  async function saveProfile(input: ServerProfileInput) {
    const profile = await profileStore.saveProfile(input);
    setProfiles(await profileStore.listProfiles());
    await model.connect(profile);
  }

  async function saveAgentConfig(input: LocalAgentConfigInput) {
    const config = await agentConfigStore.saveAgentConfig(input);
    setAgentConfigs(await agentConfigStore.listAgentConfigs());
    return config;
  }

  async function startRelay(config: LocalAgentConfig) {
    if (!snapshot.profile) return;
    const token = await profileStore.getToken(snapshot.profile.id);
    await relay.start({
      profile: snapshot.profile,
      token,
      config,
      recentMessages: snapshot.messages,
      lastSequence: snapshot.lastSequence,
    });
  }

  async function editDraft(id: string, body: string) {
    await pendingQueue.edit(id, body);
    setPendingDrafts(await pendingQueue.list());
  }

  async function discardDraft(id: string) {
    await pendingQueue.discard(id);
    setSelectedDraftId((current) => (current === id ? null : current));
    setPendingDrafts(await pendingQueue.list());
  }

  async function sendDraft(draft: PendingDraft) {
    await pendingQueue.send(draft);
    setSelectedDraftId(null);
    setPendingDrafts(await pendingQueue.list());
    await model.catchUp();
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <h1>AgentParty</h1>
          <p className="muted">Desktop workbench</p>
        </div>
        <ProfileForm onSave={saveProfile} />
        <AgentConfigPanel
          configs={agentConfigs}
          connectedChannelId={snapshot.profile?.channelId ?? ""}
          relay={relaySnapshot}
          onSave={saveAgentConfig}
          onStart={startRelay}
          onStop={() => void relay.stop()}
          disabled={!snapshot.profile}
        />
        <div className="profile-list">
          {profiles.map((profile) => (
            <button key={profile.id} className="profile-button" onClick={() => void model.connect(profile)}>
              <span>{profile.name}</span>
              <small>{profile.channelId}</small>
            </button>
          ))}
        </div>
      </aside>
      <section className="workbench">
        <header className="toolbar">
          <ConnectionBadge profile={snapshot.profile} state={snapshot.connectionState} />
          <button className="icon-button" disabled={!snapshot.profile} onClick={() => void model.catchUp()} title="Catch up">
            <Plug size={18} />
          </button>
        </header>
        {snapshot.error ? <div className="error">{snapshot.error}</div> : null}
        <PendingQueuePanel
          drafts={pendingDrafts}
          selectedDraftId={selectedDraftId}
          onSelect={setSelectedDraftId}
          onEdit={editDraft}
          onDiscard={discardDraft}
          onSend={sendDraft}
        />
        <MessageList messages={snapshot.messages} selected={snapshot.selectedReplyTo} onReply={(message) => model.selectReplyTo(message.id)} />
        <Composer
          disabled={!model.canSend()}
          selectedReplyTo={snapshot.selectedReplyTo}
          onClearReply={() => model.selectReplyTo(null)}
          onSend={(body, mentions) => void model.send(body, mentions)}
        />
      </section>
    </main>
  );
}

function PendingQueuePanel({
  drafts,
  selectedDraftId,
  onSelect,
  onEdit,
  onDiscard,
  onSend,
}: {
  drafts: PendingDraft[];
  selectedDraftId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, body: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  onSend: (draft: PendingDraft) => Promise<void>;
}) {
  const selected = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null;
  const [body, setBody] = useState(selected?.body ?? "");

  useEffect(() => {
    setBody(selected?.body ?? "");
  }, [selected?.id, selected?.body]);

  if (drafts.length === 0) return null;

  return (
    <section className="pending-queue">
      <div className="pending-list">
        {drafts.map((draft) => (
          <button
            className={selected?.id === draft.id ? "pending-item selected" : "pending-item"}
            key={draft.id}
            onClick={() => onSelect(draft.id)}
            type="button"
          >
            <span>{draft.agentName}</span>
            <small>{draft.status} · reply to {draft.triggeringMessageId}</small>
          </button>
        ))}
      </div>
      {selected ? (
        <form
          className="pending-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void onSend({ ...selected, body });
          }}
        >
          {selected.status === "blocked" ? <div className="error compact">{selected.error ?? "Runner blocked"}</div> : null}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} disabled={selected.status !== "pending"} />
          <div className="pending-actions">
            <button type="button" disabled={selected.status !== "pending"} onClick={() => void onEdit(selected.id, body)}>
              Save edit
            </button>
            <button type="submit" disabled={selected.status !== "pending" || !body.trim()}>
              <Send size={16} /> Send
            </button>
            <button className="icon-button" type="button" onClick={() => void onDiscard(selected.id)} title="Discard">
              <Trash2 size={16} />
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ProfileForm({ onSave }: { onSave: (input: ServerProfileInput) => Promise<void> }) {
  const [input, setInput] = useState({ name: "", serverUrl: "http://127.0.0.1:4180", channelId: "", token: "" });
  const security = input.serverUrl ? classifySafely(input.serverUrl) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(input);
    setInput((current) => ({ ...current, token: "" }));
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <input value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} placeholder="Profile name" required />
      <input value={input.serverUrl} onChange={(event) => setInput({ ...input, serverUrl: event.target.value })} placeholder="Server URL" required />
      <input value={input.channelId} onChange={(event) => setInput({ ...input, channelId: event.target.value })} placeholder="Channel ID" required />
      <input value={input.token} onChange={(event) => setInput({ ...input, token: event.target.value })} placeholder="Token" type="password" required />
      {security ? <SecurityLabel security={security} /> : null}
      <button type="submit">Save and connect</button>
    </form>
  );
}

function AgentConfigPanel({
  configs,
  connectedChannelId,
  relay,
  disabled,
  onSave,
  onStart,
  onStop,
}: {
  configs: LocalAgentConfig[];
  connectedChannelId: string;
  relay: LocalRelaySnapshot;
  disabled: boolean;
  onSave: (input: LocalAgentConfigInput) => Promise<LocalAgentConfig>;
  onStart: (config: LocalAgentConfig) => Promise<void>;
  onStop: () => void;
}) {
  const [input, setInput] = useState<LocalAgentConfigInput>({
    name: "bot",
    channelId: connectedChannelId,
    runnerKind: "fake",
    workdir: "D:\\Workspace\\agentparty-fake-runner",
    sendingPolicy: "draft",
  });

  useEffect(() => {
    if (connectedChannelId) setInput((current) => ({ ...current, channelId: connectedChannelId }));
  }, [connectedChannelId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(input);
  }

  return (
    <section className="agent-panel">
      <div className="panel-title">
        <Bot size={18} />
        <span>Local relay</span>
      </div>
      <form className="profile-form" onSubmit={submit}>
        <input value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} placeholder="Agent name" required />
        <input value={input.channelId} onChange={(event) => setInput({ ...input, channelId: event.target.value })} placeholder="Channel ID" required />
        <input value={input.workdir} onChange={(event) => setInput({ ...input, workdir: event.target.value })} placeholder="Workdir" required />
        <select value={input.sendingPolicy} onChange={(event) => setInput({ ...input, sendingPolicy: event.target.value as LocalAgentConfigInput["sendingPolicy"] })}>
          <option value="draft">Draft</option>
          <option value="auto-send">Auto-send</option>
        </select>
        <button type="submit">Save agent</button>
      </form>
      <div className="profile-list">
        {configs.map((config) => (
          <div className="agent-row" key={config.id}>
            <div>
              <strong>{config.name}</strong>
              <small>{config.runnerKind} · {config.sendingPolicy}</small>
            </div>
            <button className="icon-button" disabled={disabled || relay.state === "running"} onClick={() => void onStart(config)} title="Start relay">
              <Play size={16} />
            </button>
          </div>
        ))}
      </div>
      <button className="stop-button" disabled={relay.state === "stopped"} onClick={onStop} type="button">
        <Square size={14} /> Stop relay
      </button>
      <div className="relay-status">Relay: {relay.state}</div>
      {relay.lastResult ? <div className="relay-log">Last: {relay.lastResult.contextFilePath}</div> : null}
      {relay.error ? <div className="error compact">{relay.error}</div> : null}
    </section>
  );
}

function ConnectionBadge({ profile, state }: { profile: ServerProfile | null; state: string }) {
  const security = profile ? classifySafely(profile.serverUrl) : null;
  return (
    <div className="connection">
      {state === "connected" ? <ShieldCheck size={18} /> : <WifiOff size={18} />}
      <span>{profile?.name ?? "No profile"}</span>
      {security ? <SecurityLabel security={security} /> : null}
    </div>
  );
}

function SecurityLabel({ security }: { security: "https" | "trusted-intranet-http" }) {
  if (security === "https") {
    return (
      <span className="security https">
        <Lock size={14} /> HTTPS
      </span>
    );
  }
  return (
    <span className="security http">
      <ShieldAlert size={14} /> Trusted intranet HTTP
    </span>
  );
}

function MessageList({ messages, selected, onReply }: { messages: ChannelMessage[]; selected: ChannelMessage | null; onReply: (message: ChannelMessage) => void }) {
  return (
    <div className="messages">
      {messages.map((message) => (
        <article className={selected?.id === message.id ? "message selected" : "message"} key={message.id}>
          <div className="message-meta">
            <strong>{message.sender.owner_label}</strong>
            <span>#{message.sequence}</span>
            {message.reply_to_message_id ? <span>reply</span> : null}
            <button className="icon-button" onClick={() => onReply(message)} title="Reply">
              <Reply size={16} />
            </button>
          </div>
          <p>{message.body}</p>
        </article>
      ))}
    </div>
  );
}

function Composer({ disabled, selectedReplyTo, onClearReply, onSend }: { disabled: boolean; selectedReplyTo: ChannelMessage | null; onClearReply: () => void; onSend: (body: string, mentions: string[]) => void }) {
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    onSend(
      body,
      mentions
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    setBody("");
  }

  return (
    <form className="composer" onSubmit={submit}>
      {selectedReplyTo ? (
        <div className="reply-context">
          Replying to #{selectedReplyTo.sequence}
          <button type="button" onClick={onClearReply}>Clear</button>
        </div>
      ) : null}
      <input value={mentions} onChange={(event) => setMentions(event.target.value)} placeholder="Mentions, comma separated" disabled={disabled} />
      <div className="send-row">
        <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={disabled ? "Disconnected" : "Message"} disabled={disabled} />
        <button className="send-button" disabled={disabled || !body.trim()} type="submit" title="Send">
          <Send size={18} />
        </button>
      </div>
    </form>
  );
}

function classifySafely(url: string) {
  try {
    return classifyServerUrl(url);
  } catch {
    return null;
  }
}
