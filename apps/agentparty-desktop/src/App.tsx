import { FormEvent, useEffect, useMemo, useState } from "react";
import { Lock, Plug, Reply, Send, ShieldAlert, ShieldCheck, WifiOff } from "lucide-react";
import { HttpProtocolClient } from "./protocolClient";
import { classifyServerUrl, MemoryProfileStore, TauriProfileStore } from "./profileStore";
import type { ChannelMessage, ServerProfile, ServerProfileInput } from "./types";
import { WorkbenchModel, type WorkbenchSnapshot } from "./workbenchModel";
import "./styles.css";

const fallbackStore = new MemoryProfileStore();

function createProfileStore() {
  try {
    return new TauriProfileStore();
  } catch {
    return fallbackStore;
  }
}

export function App() {
  const profileStore = useMemo(createProfileStore, []);
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>({
    connectionState: "disconnected",
    profile: null,
    messages: [],
    selectedReplyTo: null,
    lastSequence: 0,
    error: null,
  });
  const model = useMemo(() => new WorkbenchModel(profileStore, new HttpProtocolClient(), setSnapshot), [profileStore]);

  useEffect(() => {
    void profileStore.listProfiles().then(setProfiles);
  }, [profileStore]);

  async function saveProfile(input: ServerProfileInput) {
    const profile = await profileStore.saveProfile(input);
    setProfiles(await profileStore.listProfiles());
    await model.connect(profile);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <h1>AgentParty</h1>
          <p className="muted">Desktop workbench</p>
        </div>
        <ProfileForm onSave={saveProfile} />
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
