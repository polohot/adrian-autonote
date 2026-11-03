import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { getNote, listCaptures, retryCapture, saveCapture, undoCapture, type Capture, type Piece } from "./api.ts";

const UNSURE_BELOW = 0.6;
const POLL_MS = 1500;

const STATUS_LABELS: Record<Capture["status"], string> = {
  queued: "Sorting…",
  sorting: "Sorting…",
  filed: "Filed",
  failed: "Failed",
  waiting: "Waiting for an AI connection",
  undone: "Undone",
};

function formatTime(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString()} ${time}`;
}

const stripFrontmatter = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, "");

function CaptureBox({ onSaved }: { onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (text.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveCapture(text);
      setText("");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void save();
  }

  return (
    <form className="capture-box" onSubmit={save}>
      <textarea
        aria-label="Capture"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Type anything: an idea, a to-do, a trip plan… AutoNote files it for you."
        rows={5}
        autoFocus
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy || text.trim() === ""}>
          {busy ? "Saving…" : "Save"}
        </button>
        <span className="hint">Ctrl+Enter to save</span>
      </div>
    </form>
  );
}

function PieceRow({ piece }: { piece: Piece }) {
  const [body, setBody] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (!open && body === null) setBody(stripFrontmatter((await getNote(piece.noteId)).markdown));
    setOpen(!open);
  }

  return (
    <li className="piece">
      <div className="piece-line">
        <span className="piece-title">{piece.title}</span>
        <span className="piece-meta">
          <span className="arrow" aria-hidden="true">
            →
          </span>
          <span className="topic">{piece.topic}</span>
          {piece.newTopic && <span className="tag">new topic</span>}
          {piece.confidence < UNSURE_BELOW && <span className="tag warn">unsure</span>}
          <button className="link" onClick={toggle} aria-expanded={open}>
            {open ? "Hide" : "Show"}
          </button>
        </span>
      </div>
      {open && body !== null && <div className="note-body">{body}</div>}
    </li>
  );
}

function CaptureItem({ capture, onChanged }: { capture: Capture; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = (action: (id: string) => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await action(capture.id);
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const tokens = capture.inputTokens + capture.outputTokens;

  return (
    <li className={`capture status-${capture.status}`}>
      <div className="capture-header">
        <span className="status">{STATUS_LABELS[capture.status]}</span>
        <span className="hint">{formatTime(capture.createdAt)}</span>
      </div>
      <p className="preview">{capture.preview}</p>
      {capture.error && <p className="error">{capture.error}</p>}
      {capture.pieces.length > 0 && (
        <ul className="pieces">
          {capture.pieces.map((piece) => (
            <PieceRow key={piece.noteId} piece={piece} />
          ))}
        </ul>
      )}
      <div className="actions">
        {capture.status === "filed" && (
          <button className="secondary" onClick={act(undoCapture)} disabled={busy}>
            Undo
          </button>
        )}
        {(capture.status === "failed" || capture.status === "waiting") && (
          <button className="secondary" onClick={act(retryCapture)} disabled={busy}>
            Retry
          </button>
        )}
        {tokens > 0 && <span className="hint">{tokens.toLocaleString()} tokens</span>}
      </div>
    </li>
  );
}

interface HomeProps {
  /** Show the one-time "New org created." note. */
  created: boolean;
  onCreatedSeen: () => void;
}

export function HomePage({ created, onCreatedSeen }: HomeProps) {
  const [feed, setFeed] = useState<{ hasConnection: boolean; captures: Capture[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    listCaptures()
      .then((result) => {
        setFeed(result);
        setError(null);
      })
      .catch(() => setError("Could not load your activity."));
  }, []);

  useEffect(reload, [reload]);

  const sorting = feed?.captures.some((c) => c.status === "queued" || c.status === "sorting") ?? false;
  useEffect(() => {
    if (!sorting) return;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [sorting, reload]);

  return (
    <>
      {created && <p className="note">New org created.</p>}
      {feed && !feed.hasConnection && (
        <p className="banner" role="status">
          No AI connection yet. Your notes are saved and will be sorted once you add one in{" "}
          <a href="#/settings">Settings</a>.
        </p>
      )}
      <CaptureBox
        onSaved={() => {
          onCreatedSeen();
          reload();
        }}
      />
      <h2>Activity</h2>
      {error && <p className="error">{error}</p>}
      {feed && feed.captures.length === 0 && <p className="hint">Nothing captured yet.</p>}
      {feed && feed.captures.length > 0 && (
        <ul className="feed">
          {feed.captures.map((capture) => (
            <CaptureItem key={capture.id} capture={capture} onChanged={reload} />
          ))}
        </ul>
      )}
    </>
  );
}
