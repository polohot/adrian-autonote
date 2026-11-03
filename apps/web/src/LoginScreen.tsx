import { useState, type FormEvent } from "react";
import { ApiError, signIn, type Org } from "./api.ts";

interface Props {
  onSignedIn: (org: Org, created: boolean) => void;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const minutes = Math.ceil((err.body.retryAfterSeconds ?? 60) / 60);
      return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    if (err.status === 400) return "Enter a passphrase.";
  }
  return "Could not reach the server. Try again.";
}

export function LoginScreen({ onSignedIn }: Props) {
  const [passphrase, setPassphrase] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { org, created } = await signIn(passphrase);
      onSignedIn(org, created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <label htmlFor="passphrase">Passphrase</label>
      <input
        id="passphrase"
        type={show ? "text" : "password"}
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        autoComplete="current-password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      <label className="inline">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passphrase
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || passphrase.trim() === ""}>
        {busy ? "Opening…" : "Continue"}
      </button>
    </form>
  );
}
