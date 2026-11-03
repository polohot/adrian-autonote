import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { MAX_TOPICS_IN_PROMPT } from "@autonote/engine";

export type CaptureStatus = "queued" | "sorting" | "filed" | "failed" | "waiting" | "undone";

export interface Capture {
  id: string;
  orgId: string;
  text: string;
  language: string | null;
  status: CaptureStatus;
  error: string | null;
  archivePath: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: number;
}

export interface Piece {
  noteId: string;
  title: string;
  topic: string;
  /** True when sorting this capture created the topic. */
  newTopic: boolean;
  confidence: number;
}

/** What the activity feed shows for one capture. */
export interface CaptureView {
  id: string;
  preview: string;
  status: CaptureStatus;
  error: string | null;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  pieces: Piece[];
}

interface CaptureRow {
  id: string;
  org_id: string;
  text: string;
  language: string | null;
  status: CaptureStatus;
  error: string | null;
  archive_path: string;
  input_tokens: number;
  output_tokens: number;
  created_at: number;
}

const toCapture = (row: CaptureRow): Capture => ({
  id: row.id,
  orgId: row.org_id,
  text: row.text,
  language: row.language,
  status: row.status,
  error: row.error,
  archivePath: row.archive_path,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  createdAt: row.created_at,
});

export function insertCapture(
  db: DatabaseSync,
  capture: { id: string; orgId: string; text: string; language: string | null; archivePath: string },
  now: number,
): void {
  db.prepare(
    `INSERT INTO captures (id, org_id, text, language, status, archive_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
  ).run(capture.id, capture.orgId, capture.text, capture.language, capture.archivePath, now, now);
}

export function getCapture(db: DatabaseSync, id: string): Capture | null {
  const row = db.prepare("SELECT * FROM captures WHERE id = ?").get(id) as CaptureRow | undefined;
  return row ? toCapture(row) : null;
}

export function getOrgCapture(db: DatabaseSync, orgId: string, id: string): Capture | null {
  const capture = getCapture(db, id);
  return capture?.orgId === orgId ? capture : null;
}

export function setStatus(
  db: DatabaseSync,
  id: string,
  status: CaptureStatus,
  now: number,
  extra: { error?: string | null; usage?: { inputTokens: number; outputTokens: number } } = {},
): void {
  db.prepare(
    `UPDATE captures SET status = ?, error = ?, updated_at = ?,
       input_tokens = input_tokens + ?, output_tokens = output_tokens + ?
     WHERE id = ?`,
  ).run(status, extra.error ?? null, now, extra.usage?.inputTokens ?? 0, extra.usage?.outputTokens ?? 0, id);
}

export function captureIdsWithStatus(db: DatabaseSync, statuses: CaptureStatus[], orgId?: string): string[] {
  const placeholders = statuses.map(() => "?").join(", ");
  const sql = `SELECT id FROM captures WHERE status IN (${placeholders})${orgId ? " AND org_id = ?" : ""} ORDER BY created_at`;
  const rows = db.prepare(sql).all(...statuses, ...(orgId ? [orgId] : [])) as { id: string }[];
  return rows.map((row) => row.id);
}

/** Most recently used first, as many as the sorting prompt takes. */
export function topicPaths(db: DatabaseSync, orgId: string): string[] {
  const rows = db
    .prepare("SELECT path FROM topics WHERE org_id = ? ORDER BY last_used_at DESC, path LIMIT ?")
    .all(orgId, MAX_TOPICS_IN_PROMPT) as { path: string }[];
  return rows.map((row) => row.path);
}

/** Returns the topic's ID and its stored path, which keeps the capitalization it was created with. */
export function findOrCreateTopic(
  db: DatabaseSync,
  orgId: string,
  path: string,
  captureId: string,
  now: number,
): { id: string; path: string } {
  db.prepare(
    `INSERT INTO topics (id, org_id, path, created_by_capture_id, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (org_id, path) DO UPDATE SET last_used_at = excluded.last_used_at`,
  ).run(randomUUID(), orgId, path, captureId, now, now);
  return db.prepare("SELECT id, path FROM topics WHERE org_id = ? AND path = ?").get(orgId, path) as { id: string; path: string };
}

export function insertNote(
  db: DatabaseSync,
  note: { id: string; orgId: string; captureId: string; topicId: string; title: string; filePath: string; confidence: number },
  now: number,
): void {
  db.prepare(
    `INSERT INTO notes (id, org_id, capture_id, topic_id, title, file_path, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(note.id, note.orgId, note.captureId, note.topicId, note.title, note.filePath, note.confidence, now);
}

export function noteFilesForCapture(db: DatabaseSync, captureId: string): { id: string; filePath: string }[] {
  return (db.prepare("SELECT id, file_path FROM notes WHERE capture_id = ?").all(captureId) as { id: string; file_path: string }[]).map(
    (row) => ({ id: row.id, filePath: row.file_path }),
  );
}

/** Deletes the capture's note rows, and topics it created that no note uses any more. */
export function deleteCaptureNotes(db: DatabaseSync, captureId: string): void {
  db.prepare("DELETE FROM notes WHERE capture_id = ?").run(captureId);
  db.prepare(
    `DELETE FROM topics WHERE created_by_capture_id = ?
       AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.topic_id = topics.id)`,
  ).run(captureId);
}

export function getNote(
  db: DatabaseSync,
  orgId: string,
  id: string,
): { id: string; title: string; topic: string; filePath: string } | null {
  const row = db
    .prepare(
      `SELECT n.id, n.title, t.path AS topic, n.file_path FROM notes n JOIN topics t ON t.id = n.topic_id
       WHERE n.id = ? AND n.org_id = ?`,
    )
    .get(id, orgId) as { id: string; title: string; topic: string; file_path: string } | undefined;
  return row ? { id: row.id, title: row.title, topic: row.topic, filePath: row.file_path } : null;
}

export function listCaptureViews(db: DatabaseSync, orgId: string, limit = 30): CaptureView[] {
  const captures = db
    .prepare("SELECT * FROM captures WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(orgId, limit) as unknown as CaptureRow[];
  return toViews(db, captures);
}

export function getCaptureView(db: DatabaseSync, orgId: string, id: string): CaptureView | null {
  const row = db.prepare("SELECT * FROM captures WHERE id = ? AND org_id = ?").get(id, orgId) as CaptureRow | undefined;
  return row ? toViews(db, [row])[0]! : null;
}

function toViews(db: DatabaseSync, captures: CaptureRow[]): CaptureView[] {
  if (captures.length === 0) return [];

  const placeholders = captures.map(() => "?").join(", ");
  const pieces = db
    .prepare(
      `SELECT n.capture_id, n.id AS note_id, n.title, t.path AS topic, n.confidence,
              (t.created_by_capture_id IS n.capture_id) AS new_topic
       FROM notes n JOIN topics t ON t.id = n.topic_id
       WHERE n.capture_id IN (${placeholders})
       ORDER BY n.rowid`,
    )
    .all(...captures.map((c) => c.id)) as {
    capture_id: string;
    note_id: string;
    title: string;
    topic: string;
    confidence: number;
    new_topic: number;
  }[];

  return captures.map((row) => ({
    id: row.id,
    preview: row.text.length > 200 ? `${row.text.slice(0, 200)}…` : row.text,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    pieces: pieces
      .filter((piece) => piece.capture_id === row.id)
      .map((piece) => ({
        noteId: piece.note_id,
        title: piece.title,
        topic: piece.topic,
        newTopic: piece.new_topic === 1,
        confidence: piece.confidence,
      })),
  }));
}
