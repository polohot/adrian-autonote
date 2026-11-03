import { useEffect, useState } from "react";
import { getHealth, getSession, signOut, type Health, type Org } from "./api.ts";
import { HomePage } from "./HomePage.tsx";
import { LoginScreen } from "./LoginScreen.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

type SessionState = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; org: Org; created: boolean };

type Page = "home" | "settings";

const pageFromHash = (): Page => (window.location.hash === "#/settings" ? "settings" : "home");

function useHashPage(): Page {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const onChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return page;
}

export function App() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const page = useHashPage();

  const dismissCreated = () => setSession((s) => (s.kind === "signed-in" && s.created ? { ...s, created: false } : s));
  useEffect(() => {
    if (page !== "home") dismissCreated();
  }, [page]);

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
    window.location.hash = "";
    setSession({ kind: "signed-out" });
  }

  return (
    <main>
      <header>
        <h1>AutoNote</h1>
        {session.kind === "signed-in" && (
          <nav aria-label="Main">
            <a href="#/" aria-current={page === "home" ? "page" : undefined}>
              Home
            </a>
            <a href="#/settings" aria-current={page === "settings" ? "page" : undefined}>
              Settings
            </a>
            <button className="secondary" onClick={handleSignOut}>
              Sign out
            </button>
          </nav>
        )}
      </header>
      {error && <p className="error">{error}</p>}

      {session.kind === "signed-out" && (
        <LoginScreen onSignedIn={(org, created) => setSession({ kind: "signed-in", org, created })} />
      )}

      {session.kind === "signed-in" &&
        (page === "settings" ? <SettingsPage health={health} /> : <HomePage created={session.created} onCreatedSeen={dismissCreated} />)}
    </main>
  );
}
