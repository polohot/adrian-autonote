export interface Org {
  id: string;
  createdAt: number;
}

export interface Health {
  status: string;
  version: string;
  sqlite: string;
  sqliteVec: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; message?: string; retryAfterSeconds?: number },
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getHealth = () => request<Health>("/api/health");

/** Resolves to null when not signed in. */
export async function getSession(): Promise<Org | null> {
  try {
    return (await request<{ org: Org }>("/api/session")).org;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const signIn = (passphrase: string) =>
  request<{ org: Org; created: boolean }>("/api/session", { method: "POST", body: JSON.stringify({ passphrase }) });

export const signOut = () => request<void>("/api/session", { method: "DELETE" });

export type ApiStyle = "auto" | "responses" | "chat-completions";

export interface AiProfile {
  id: string;
  name: string;
  url: string;
  api: ApiStyle;
  model: string;
  keyHint: string;
  active: boolean;
}

export interface ProfileInput {
  name: string;
  url: string;
  api: ApiStyle;
  model: string;
  /** Empty when editing means "keep the current key". */
  apiKey: string;
}

export type TestResult = { ok: true; reply: string; latencyMs: number } | { ok: false; error: string };

export const listProfiles = () => request<{ profiles: AiProfile[] }>("/api/ai-profiles").then((r) => r.profiles);
export const createProfile = (input: ProfileInput) =>
  request<AiProfile>("/api/ai-profiles", { method: "POST", body: JSON.stringify(input) });
export const updateProfile = (id: string, input: ProfileInput) =>
  request<AiProfile>(`/api/ai-profiles/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteProfile = (id: string) => request<void>(`/api/ai-profiles/${id}`, { method: "DELETE" });
export const activateProfile = (id: string) => request<void>(`/api/ai-profiles/${id}/activate`, { method: "POST" });
export const testProfile = (id: string) => request<TestResult>(`/api/ai-profiles/${id}/test`, { method: "POST" });

export type CaptureStatus = "queued" | "sorting" | "filed" | "failed" | "waiting" | "undone";

export interface Piece {
  noteId: string;
  title: string;
  topic: string;
  newTopic: boolean;
  confidence: number;
}

export interface Capture {
  id: string;
  preview: string;
  status: CaptureStatus;
  error: string | null;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  pieces: Piece[];
}

export interface Note {
  id: string;
  title: string;
  topic: string;
  markdown: string;
}

export const listCaptures = () => request<{ hasConnection: boolean; captures: Capture[] }>("/api/captures");
export const saveCapture = (text: string) =>
  request<Capture>("/api/captures", { method: "POST", body: JSON.stringify({ text, language: navigator.language }) });
export const undoCapture = (id: string) => request<Capture>(`/api/captures/${id}/undo`, { method: "POST" });
export const retryCapture = (id: string) => request<Capture>(`/api/captures/${id}/retry`, { method: "POST" });
export const getNote = (id: string) => request<Note>(`/api/notes/${id}`);
