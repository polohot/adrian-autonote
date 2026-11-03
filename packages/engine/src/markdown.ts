export const FALLBACK_TOPIC = "Inbox";
const MAX_TOPIC_DEPTH = 4;
const MAX_SEGMENT_LENGTH = 60;
const MAX_FILE_NAME_LENGTH = 80;

/** Characters that are invalid in file names on Windows, macOS or Linux, or special in Obsidian links. */
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*#^[\]]/g;

function cleanSegment(raw: string, maxLength: number): string {
  return raw
    .normalize("NFC")
    .replace(UNSAFE, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[._\s]+/, "") // no hidden or reserved (_archive) folders, no ".."
    .slice(0, maxLength)
    .replace(/[.\s]+$/, ""); // Windows drops trailing dots and spaces
}

/**
 * Makes a topic path from the model safe to use as folders inside the vault.
 * Returns null when nothing usable is left.
 */
export function cleanTopicPath(raw: string): string | null {
  const segments = raw
    .split(/[/\\]+/)
    .map((segment) => cleanSegment(segment, MAX_SEGMENT_LENGTH))
    .filter((segment) => segment !== "")
    .slice(0, MAX_TOPIC_DEPTH);
  return segments.length > 0 ? segments.join("/") : null;
}

/** Picks the existing topic with the same path ignoring case, or the cleaned path, or the fallback. */
export function resolveTopic(raw: string, existingTopics: readonly string[]): string {
  const cleaned = cleanTopicPath(raw) ?? FALLBACK_TOPIC;
  return existingTopics.find((topic) => topic.toLocaleLowerCase() === cleaned.toLocaleLowerCase()) ?? cleaned;
}

/** File name (without folder) for a note title; the caller adds " 2", " 3", … on collisions. */
export function noteFileName(title: string, suffix = 1): string {
  const base = cleanSegment(title, MAX_FILE_NAME_LENGTH) || "Untitled";
  return `${base}${suffix > 1 ? ` ${suffix}` : ""}.md`;
}

type FrontmatterValue = string | number;

/** YAML frontmatter; strings are JSON-quoted, which is valid YAML and safe for any text. */
export function renderFrontmatter(fields: Record<string, FrontmatterValue>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

export interface NoteFile {
  id: string;
  title: string;
  topic: string;
  created: string;
  /** Vault-relative path of the original, without ".md". */
  sourcePath: string;
  body: string;
}

export function renderNote(note: NoteFile): string {
  const frontmatter = renderFrontmatter({
    id: note.id,
    title: note.title,
    topic: note.topic,
    created: note.created,
    source: `[[${note.sourcePath}]]`,
  });
  return `${frontmatter}\n${note.body.trim()}\n`;
}

export function renderArchive(capture: { id: string; captured: string; text: string }): string {
  return `${renderFrontmatter({ id: capture.id, captured: capture.captured })}\n${capture.text.trim()}\n`;
}
