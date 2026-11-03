import { useEffect, useState } from "react";

interface Health {
  status: string;
  version: string;
  sqlite: string;
  sqliteVec: string;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => (res.ok ? (res.json() as Promise<Health>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(setHealth)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <main>
      <h1>AutoNote</h1>
      <p>Quick-capture notes that sort themselves.</p>
      {error && <p className="error">Server unreachable: {error}</p>}
      {health && (
        <dl>
          <dt>Status</dt>
          <dd>{health.status}</dd>
          <dt>Version</dt>
          <dd>{health.version}</dd>
          <dt>SQLite</dt>
          <dd>{health.sqlite}</dd>
          <dt>sqlite-vec</dt>
          <dd>{health.sqliteVec}</dd>
        </dl>
      )}
      {!health && !error && <p>Checking server…</p>}
    </main>
  );
}
