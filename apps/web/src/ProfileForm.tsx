import { resolveEndpoint } from "@autonote/engine";
import { useId, useState, type FormEvent } from "react";
import type { AiProfile, ApiStyle, ProfileInput } from "./api.ts";

interface Props {
  /** Present when editing an existing profile. */
  profile?: AiProfile;
  onSave: (input: ProfileInput) => Promise<void>;
  onCancel: () => void;
}

const API_LABELS: Record<string, string> = { responses: "Responses API", "chat-completions": "Chat Completions API" };

function preview(url: string, api: ApiStyle): { ok: true; text: string } | { ok: false; text: string } | null {
  if (url.trim() === "") return null;
  try {
    const endpoint = resolveEndpoint(url, api === "auto" ? "responses" : api);
    return { ok: true, text: `Will call: ${endpoint.url} (${API_LABELS[endpoint.api]})` };
  } catch (err) {
    return { ok: false, text: (err as Error).message };
  }
}

export function ProfileForm({ profile, onSave, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(profile?.name ?? "");
  const [url, setUrl] = useState(profile?.url ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState<ApiStyle>(profile?.api ?? "auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpoint = preview(url, api);
  const canSave = name.trim() !== "" && model.trim() !== "" && endpoint?.ok === true && !busy;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, url, model, apiKey, api });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="profile-form" onSubmit={submit} aria-label={profile ? `Edit ${profile.name}` : "New connection"}>
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Work: Azure Foundry" />

      <label htmlFor={`${id}-url`}>URL</label>
      <input
        id={`${id}-url`}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://<resource>.services.ai.azure.com/openai/v1/"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {endpoint && (
        <p className={endpoint.ok ? "hint" : "error"} role="status">
          {endpoint.text}
        </p>
      )}

      <label htmlFor={`${id}-model`}>Model</label>
      <input
        id={`${id}-model`}
        value={model}
        onChange={(e) => setModel(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <p className="hint">On Azure, this is the deployment name.</p>

      <label htmlFor={`${id}-key`}>API key</label>
      <input
        id={`${id}-key`}
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        autoComplete="off"
        placeholder={profile?.keyHint ? `Leave blank to keep the current key (${profile.keyHint})` : "Leave blank for local servers"}
      />

      <label htmlFor={`${id}-api`}>API style</label>
      <select id={`${id}-api`} value={api} onChange={(e) => setApi(e.target.value as ApiStyle)}>
        <option value="auto">Auto (from the URL)</option>
        <option value="responses">Responses</option>
        <option value="chat-completions">Chat Completions</option>
      </select>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={!canSave}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
