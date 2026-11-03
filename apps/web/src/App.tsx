import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getHealth, getSession, listPending, signOut, type Health, type Org } from "./api.ts";
import { HomePage } from "./HomePage.tsx";
import { AddIcon, ChatIcon, PendingIcon, SettingsIcon } from "./icons.tsx";
import { LoginScreen } from "./LoginScreen.tsx";
import { PendingPage } from "./PendingPage.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

type SessionState = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; org: Org; created: boolean };

type Page = "chat" | "add" | "pending" | "settings";

const PAGES: Record<string, Page> = { "#/chat": "chat", "#/pending": "pending", "#/settings": "settings" };
const pageFromHash = (): Page => PAGES[window.location.hash] ?? "add";

function useHashPage(): Page {
  const [page, setPage] = useState(pageFromHash);
  useEffect(() => {
    const onChange = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return page;
}

function MenuLink({ href, page, current, icon, children }: { href: string; page: Page; current: Page; icon: ReactNode; children: ReactNode }) {
  return (
    <a href={href} className={`menu-link menu-${page}`} aria-current={page === current ? "page" : undefined}>
      {icon}
      <span className="menu-label">{children}</span>
    </a>
  );
}

function ChatPage() {
  return (
    <section>
      <h1>Chat</h1>
      <p>Coming next: ask questions about your notes and get answers with links to the sources, or tell AutoNote to move and rename things.</p>
    </section>
  );
}

export function App() {
  const [session, setSession] = useState<SessionState>({ kind: "loading" });
  const [health, setHealth] = useState<Health | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const page = useHashPage();
  const signedIn = session.kind === "signed-in";

  const dismissCreated = () => setSession((s) => (s.kind === "signed-in" && s.created ? { ...s, created: false } : s));
  const refreshPending = useCallback(() => {
    listPending()
      .then((items) => setPendingCount(items.length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getSession()
      .then((org) => setSession(org ? { kind: "signed-in", org, created: false } : { kind: "signed-out" }))
      .catch(() => setError("Server unreachable."));
    getHealth()
      .then(setHealth)
      .catch(() => setError("Server unreachable."));
  }, []);

  useEffect(() => {
    if (page !== "add") dismissCreated();
    if (signedIn) refreshPending();
  }, [page, signedIn, refreshPending]);

  async function handleSignOut() {
    await signOut();
    window.location.hash = "";
    setSession({ kind: "signed-out" });
  }

  if (session.kind !== "signed-in") {
    return (
      <main className="login-page">
        <h1>AutoNote</h1>
        {error && <p className="error">{error}</p>}
        {session.kind === "signed-out" && (
          <LoginScreen onSignedIn={(org, created) => setSession({ kind: "signed-in", org, created })} />
        )}
      </main>
    );
  }

  return (
    <div className="app">
      <nav className="menu" aria-label="Main">
        <span className="brand">AutoNote</span>
        <MenuLink href="#/chat" page="chat" current={page} icon={<ChatIcon />}>
          Chat
        </MenuLink>
        <MenuLink href="#/" page="add" current={page} icon={<AddIcon />}>
          Add Notes
        </MenuLink>
        <MenuLink href="#/pending" page="pending" current={page} icon={<PendingIcon />}>
          Pending
          {pendingCount > 0 && <span className="count">{pendingCount}</span>}
        </MenuLink>
        <MenuLink href="#/settings" page="settings" current={page} icon={<SettingsIcon />}>
          Settings
        </MenuLink>
      </nav>
      <main>
        {error && <p className="error">{error}</p>}
        {page === "chat" && <ChatPage />}
        {page === "add" && <HomePage created={session.created} onCreatedSeen={dismissCreated} onActivity={refreshPending} />}
        {page === "pending" && <PendingPage onChanged={refreshPending} />}
        {page === "settings" && <SettingsPage health={health} onSignOut={handleSignOut} />}
      </main>
    </div>
  );
}
