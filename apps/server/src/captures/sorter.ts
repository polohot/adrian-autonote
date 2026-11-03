import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { generateText, needsReview, noteFileName, renderNote, resolveTopic, sortCapture, usageOf } from "@autonote/engine";
import { getActiveConnection } from "../ai/profiles.ts";
import type { Vault } from "../vault.ts";
import { deletePendingForCapture, insertPending } from "./pending.ts";
import {
  captureIdsWithStatus,
  deleteCaptureNotes,
  findOrCreateTopic,
  getCapture,
  insertNote,
  noteFilesForCapture,
  setStatus,
  topicPaths,
  type Capture,
} from "./store.ts";

export interface SorterOptions {
  db: DatabaseSync;
  vault: Vault;
  fetch: typeof fetch;
  now: () => number;
}

export interface PieceToFile {
  title: string;
  body: string;
  /** Raw or cleaned topic path; matched to an existing topic regardless of case. */
  topic: string;
  confidence: number;
}

/** Sorts captures one at a time in the background, in the order they were queued. */
export class Sorter {
  private readonly queue: string[] = [];
  private running: Promise<void> | null = null;

  constructor(private readonly options: SorterOptions) {}

  enqueue(captureId: string): void {
    if (!this.queue.includes(captureId)) this.queue.push(captureId);
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      // Something may have been queued after the loop saw an empty queue.
      if (this.queue.length > 0) this.start();
    });
  }

  /** After a restart: picks up captures that were queued or mid-sort. */
  resumeUnfinished(): void {
    const { db, now } = this.options;
    for (const id of captureIdsWithStatus(db, ["queued", "sorting"])) {
      setStatus(db, id, "queued", now());
      this.enqueue(id);
    }
  }

  /** After an AI connection was added or switched. */
  resumeWaiting(orgId: string): void {
    const { db, now } = this.options;
    for (const id of captureIdsWithStatus(db, ["waiting"], orgId)) {
      setStatus(db, id, "queued", now());
      this.enqueue(id);
    }
  }

  /** Resolves when the queue is empty. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Removes the capture's notes, its Pending pieces and the empty topic folders it created; the original stays archived. */
  async undo(capture: Capture): Promise<void> {
    await this.removeNotes(capture);
    deletePendingForCapture(this.options.db, capture.id);
    setStatus(this.options.db, capture.id, "undone", this.options.now());
  }

  /** Writes one piece as a note in its topic folder and returns the note ID. */
  async filePiece(capture: Capture, piece: PieceToFile): Promise<string> {
    const { db, vault, now } = this.options;
    const path = resolveTopic(piece.topic, topicPaths(db, capture.orgId));
    const topic = findOrCreateTopic(db, capture.orgId, path, capture.id, now());
    const noteId = randomUUID();
    const markdown = renderNote({
      id: noteId,
      title: piece.title,
      topic: topic.path,
      created: new Date(now()).toISOString(),
      sourcePath: capture.archivePath.replace(/\.md$/, ""),
      body: piece.body,
    });
    const filePath = await vault.writeNew(capture.orgId, topic.path, (n) => noteFileName(piece.title, n), markdown);
    insertNote(
      db,
      { id: noteId, orgId: capture.orgId, captureId: capture.id, topicId: topic.id, title: piece.title, filePath, confidence: piece.confidence },
      now(),
    );
    return noteId;
  }

  private async drain(): Promise<void> {
    for (let id = this.queue.shift(); id; id = this.queue.shift()) {
      try {
        await this.sortOne(id);
      } catch (err) {
        console.error(`Sorting capture ${id} failed unexpectedly:`, err);
        setStatus(this.options.db, id, "failed", this.options.now(), { error: "Unexpected error while sorting" });
      }
    }
  }

  private async sortOne(id: string): Promise<void> {
    const { db, fetch, now } = this.options;
    const capture = getCapture(db, id);
    if (!capture || capture.status !== "queued") return;

    const connection = getActiveConnection(db, capture.orgId);
    if (!connection) {
      setStatus(db, id, "waiting", now());
      return;
    }
    setStatus(db, id, "sorting", now());

    let result;
    try {
      result = await sortCapture(
        capture.text,
        topicPaths(db, capture.orgId),
        (request) => generateText(connection, request, { fetch }),
        { language: capture.language ?? undefined },
      );
    } catch (err) {
      setStatus(db, id, "failed", now(), { error: err instanceof Error ? err.message : String(err), usage: usageOf(err) });
      return;
    }

    try {
      for (const piece of result.pieces) {
        if (needsReview(piece)) insertPending(db, capture.orgId, capture.id, piece, now());
        else await this.filePiece(capture, piece);
      }
      setStatus(db, id, "filed", now(), { usage: result.usage });
    } catch (err) {
      await this.removeNotes(capture);
      deletePendingForCapture(db, capture.id);
      setStatus(db, id, "failed", now(), {
        error: `Could not save the notes: ${err instanceof Error ? err.message : String(err)}`,
        usage: result.usage,
      });
    }
  }

  private async removeNotes(capture: Capture): Promise<void> {
    const { db, vault } = this.options;
    for (const note of noteFilesForCapture(db, capture.id)) {
      await vault.remove(capture.orgId, note.filePath);
    }
    deleteCaptureNotes(db, capture.id);
  }
}
