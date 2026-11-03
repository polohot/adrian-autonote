import { useEffect, useState } from "react";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  listProfiles,
  testProfile,
  updateProfile,
  type AiProfile,
  type Health,
  type TestResult,
} from "./api.ts";
import { ProfileForm } from "./ProfileForm.tsx";

type TestState = { kind: "testing" } | { kind: "done"; result: TestResult };

function ProfileCard({ profile, onChanged, onEdit }: { profile: AiProfile; onChanged: () => void; onEdit: () => void }) {
  const [test, setTest] = useState<TestState | null>(null);

  async function runTest() {
    setTest({ kind: "testing" });
    try {
      setTest({ kind: "done", result: await testProfile(profile.id) });
    } catch (err) {
      setTest({ kind: "done", result: { ok: false, error: (err as Error).message } });
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the connection "${profile.name}"?`)) return;
    await deleteProfile(profile.id);
    onChanged();
  }

  return (
    <li className="profile" aria-label={profile.name}>
      <div className="profile-title">
        <strong>{profile.name}</strong>
        {profile.active && <span className="badge">Active</span>}
      </div>
      <dl>
        <dt>URL</dt>
        <dd className="wrap">{profile.url}</dd>
        <dt>Model</dt>
        <dd>{profile.model}</dd>
        <dt>Key</dt>
        <dd>{profile.keyHint || "none"}</dd>
      </dl>
      <div className="actions">
        <button onClick={runTest} disabled={test?.kind === "testing"}>
          {test?.kind === "testing" ? "Testing…" : "Test"}
        </button>
        {!profile.active && (
          <button onClick={() => activateProfile(profile.id).then(onChanged)}>Use this one</button>
        )}
        <button className="secondary" onClick={onEdit}>
          Edit
        </button>
        <button className="secondary danger" onClick={remove}>
          Delete
        </button>
      </div>
      {test?.kind === "done" &&
        (test.result.ok ? (
          <p className="note" role="status">
            Connected: replied "{test.result.reply}" in {test.result.latencyMs} ms.
          </p>
        ) : (
          <p className="error" role="status">
            Failed: {test.result.error}
          </p>
        ))}
    </li>
  );
}

export function SettingsPage({ health, onSignOut }: { health: Health | null; onSignOut: () => void }) {
  const [profiles, setProfiles] = useState<AiProfile[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    listProfiles()
      .then(setProfiles)
      .catch(() => setError("Could not load connections."));

  useEffect(() => {
    void reload();
  }, []);

  if (!profiles) return <p>{error ?? "Loading…"}</p>;

  return (
    <section>
      <h1>Settings</h1>
      <h2>AI connections</h2>
      {profiles.length === 0 && editing !== "new" && <p>No connections yet. Add one so AutoNote can sort your notes.</p>}
      <ul className="profiles">
        {profiles.map((profile) =>
          editing === profile.id ? (
            <li key={profile.id}>
              <ProfileForm
                profile={profile}
                onSave={async (input) => {
                  await updateProfile(profile.id, input);
                  setEditing(null);
                  await reload();
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <ProfileCard key={profile.id} profile={profile} onChanged={reload} onEdit={() => setEditing(profile.id)} />
          ),
        )}
      </ul>
      {editing === "new" ? (
        <ProfileForm
          onSave={async (input) => {
            await createProfile(input);
            setEditing(null);
            await reload();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button onClick={() => setEditing("new")}>Add connection</button>
      )}

      <h2>Account</h2>
      <p>
        <button className="secondary" onClick={onSignOut}>
          Sign out
        </button>{" "}
        <span className="hint">Signs out this device only.</span>
      </p>

      {health && (
        <>
          <h2>About</h2>
          <dl>
            <dt>Version</dt>
            <dd>{health.version}</dd>
            <dt>SQLite</dt>
            <dd>{health.sqlite}</dd>
            <dt>sqlite-vec</dt>
            <dd>{health.sqliteVec}</dd>
          </dl>
        </>
      )}
    </section>
  );
}
