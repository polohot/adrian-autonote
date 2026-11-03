import { useEffect, useState } from "react";
import { getHealth, getSession, signOut, type Health, type Org } from "./api.ts";
import { LoginScreen } from "./LoginScreen.tsx";

type SessionState = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; org: Org; created: boolean };

export function App() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((org) => setSession(org ? { kind: "signed-in", org, created: false } : { kind: "signed-out" }))
      .catch(() => setError("Server unreachable."));
    getHealth()
      .then(setHealth)
      .catch(() => setError("Server unreachable."));
  }, []);

  async function handleSignOut() {
    await signOut();
    setSession({ kind: "signed-out" });
  }

  return (
    <main>
      <h1>AutoNote</h1>
      {error && <p className="error">{error}</p>}

      {session.kind === "signed-out" && (
        <LoginScreen onSignedIn={(org, created) => setSession({ kind: "signed-in", org, created })} />
      )}

      {session.kind === "signed-in" && (
        <>
          {session.created && <p className="note">New org created.</p>}
          <p>
            Signed in. <button onClick={handleSignOut}>Sign out</button>
          </p>
          {health && (
            <dl>
              <dt>Version</dt>
              <dd>{health.version}</dd>
              <dt>SQLite</dt>
              <dd>{health.sqlite}</dd>
              <dt>sqlite-vec</dt>
              <dd>{health.sqliteVec}</dd>
            </dl>
          )}
        </>
      )}
    </main>
  );
}
