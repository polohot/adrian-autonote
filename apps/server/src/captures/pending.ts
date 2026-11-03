import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SortedPiece } from "@autonote/engine";

/** A piece the AI wasn't sure about; nothing is written to the vault until the user decides. */
export interface PendingItem {
  id: string;
  captureId: string;
  capturePreview: string;
  title: string;
  body: string;
  suggestedTopic: string;
  confidence: number;
  question: string | null;
  choices: string[];
  createdAt: number;
}

interface PendingRow {
  id: string;
  capture_id: string;
  capture_text: string;
  title: string;
  body: string;
  suggested_topic: string;
  confidence: number;
  question: string | null;
  choices: string;
  created_at: number;
}

const toItem = (row: PendingRow): PendingItem => ({
  id: row.id,
  captureId: row.capture_id,
  capturePreview: row.capture_text.length > 200 ? `${row.capture_text.slice(0, 200)}…` : row.capture_text,
  title: row.title,
  body: row.body,
  suggestedTopic: row.suggested_topic,
  confidence: row.confidence,
  question: row.question,
  choices: JSON.parse(row.choices) as string[],
  createdAt: row.created_at,
});

const SELECT = `
  SELECT p.*, c.text AS capture_text FROM pending_pieces p JOIN captures c ON c.id = p.capture_id`;

export function insertPending(db: DatabaseSync, orgId: string, captureId: string, piece: SortedPiece, now: number): void {
  db.prepare(
    `INSERT INTO pending_pieces (id, org_id, capture_id, title, body, suggested_topic, confidence, question, choices, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    orgId,
    captureId,
    piece.title,
    piece.body,
    piece.topic,
    piece.confidence,
    piece.question,
    JSON.stringify(piece.choices.length > 0 ? piece.choices : [piece.topic]),
    now,
  );
}

export function listPending(db: DatabaseSync, orgId: string): PendingItem[] {
  const rows = db.prepare(`${SELECT} WHERE p.org_id = ? ORDER BY p.created_at, p.rowid`).all(orgId) as unknown as PendingRow[];
  return rows.map(toItem);
}

export function getPending(db: DatabaseSync, orgId: string, id: string): PendingItem | null {
  const row = db.prepare(`${SELECT} WHERE p.org_id = ? AND p.id = ?`).get(orgId, id) as PendingRow | undefined;
  return row ? toItem(row) : null;
}

export function deletePending(db: DatabaseSync, id: string): void {
  db.prepare("DELETE FROM pending_pieces WHERE id = ?").run(id);
}

/**
 * Takes a pending piece out of Pending so only one request can file it.
 * Runs without awaiting, so two requests can't both claim the same piece.
 */
export function claimPending(db: DatabaseSync, orgId: string, id: string): PendingItem | null {
  const item = getPending(db, orgId, id);
  if (item) deletePending(db, id);
  return item;
}

/** Puts a claimed piece back, for when filing it failed. */
export function restorePending(db: DatabaseSync, orgId: string, item: PendingItem): void {
  db.prepare(
    `INSERT INTO pending_pieces (id, org_id, capture_id, title, body, suggested_topic, confidence, question, choices, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    orgId,
    item.captureId,
    item.title,
    item.body,
    item.suggestedTopic,
    item.confidence,
    item.question,
    JSON.stringify(item.choices),
    item.createdAt,
  );
}

export function deletePendingForCapture(db: DatabaseSync, captureId: string): void {
  db.prepare("DELETE FROM pending_pieces WHERE capture_id = ?").run(captureId);
}
