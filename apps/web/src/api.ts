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
    readonly body: { error?: string; retryAfterSeconds?: number },
  ) {
    super(body.error ?? `HTTP ${status}`);
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
