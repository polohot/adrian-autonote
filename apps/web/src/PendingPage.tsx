import { useEffect, useState, type FormEvent } from "react";
import { answerPending, choosePending, dropPending, listPending, type PendingItem, type Piece } from "./api.ts";

function PendingCard({ item, onDone }: { item: PendingItem; onDone: (message: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<Piece | void>, message: (piece: Piece | void) => string) {
    setBusy(label);
    setError(null);
    try {
      onDone(message(await action()));
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const filedIn = (piece: Piece | void) => (piece ? `Filed "${piece.title}" in ${piece.topic}.` : "");

  function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (answer.trim() === "") return;
    void run("answer", () => answerPending(item.id, answer), filedIn);
  }

  function drop() {
    if (!window.confirm(`Don't save "${item.title}"? The original stays in the archive.`)) return;
    void run("drop", () => dropPending(item.id), () => `"${item.title}" was not saved.`);
  }

  return (
    <li className="pending-item" aria-label={item.title}>
      <p className="question">{item.question ?? "Where should this go?"}</p>
      <div className="pending-note">
        <strong className="piece-title">{item.title}</strong>
        <div className="note-body">{item.body}</div>
      </div>
      <div className="choices" role="group" aria-label="Choices">
        {item.choices.map((choice, index) => (
          <button key={choice} className={index === 0 ? "" : "secondary"} disabled={busy !== null} onClick={() => run(choice, () => choosePending(item.id, choice), filedIn)}>
            {busy === choice ? "Filing…" : choice}
          </button>
        ))}
      </div>
      <form className="answer" onSubmit={submitAnswer}>
        <input
          aria-label="Your answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Or answer in your own words…"
          disabled={busy !== null}
        />
        <button type="submit" disabled={busy !== null || answer.trim() === ""}>
          {busy === "answer" ? "Thinking…" : "Send"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="pending-footer">
        <span className="hint from" title={item.capturePreview}>
          From: {item.capturePreview.replace(/\s*\n+\s*/g, " / ")}
        </span>
        <button className="link danger" onClick={drop} disabled={busy !== null}>
          Don't save
        </button>
      </div>
    </li>
  );
}

export function PendingPage({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    listPending()
      .then(setItems)
      .catch(() => setError("Could not load Pending."));

  useEffect(() => {
    void reload();
  }, []);

  function done(text: string) {
    setMessage(text);
    void reload();
    onChanged();
  }

  return (
    <section>
      <h1>Pending</h1>
      {message && (
        <p className="note" role="status">
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <p className="hint">Nothing waiting. When the AI isn't sure where something belongs, it asks you here.</p>
      )}
      {items && items.length > 0 && (
        <ul className="pending-list">
          {items.map((item) => (
            <PendingCard key={item.id} item={item} onDone={done} />
          ))}
        </ul>
      )}
    </section>
  );
}
