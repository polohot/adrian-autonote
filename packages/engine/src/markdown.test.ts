import { describe, expect, it } from "vitest";
import { cleanTopicPath, noteFileName, renderArchive, renderNote, resolveTopic } from "./markdown.ts";

describe("cleanTopicPath", () => {
  it("keeps normal paths", () => {
    expect(cleanTopicPath("Travel/Japan")).toBe("Travel/Japan");
    expect(cleanTopicPath("การเดินทาง/ญี่ปุ่น")).toBe("การเดินทาง/ญี่ปุ่น");
  });

  it("can never leave the vault or reach reserved folders", () => {
    expect(cleanTopicPath("../../etc/passwd")).toBe("etc/passwd");
    expect(cleanTopicPath("/absolute/path")).toBe("absolute/path");
    expect(cleanTopicPath("C:\\Windows\\System32")).toBe("C/Windows/System32");
    expect(cleanTopicPath("_archive/2026")).toBe("archive/2026");
    expect(cleanTopicPath(".obsidian/plugins")).toBe("obsidian/plugins");
    expect(cleanTopicPath("..")).toBeNull();
  });

  it("removes characters that are invalid in file names or Obsidian links", () => {
    expect(cleanTopicPath('Work: "Projects" <2026>?|*#^[x]')).toBe("Work Projects 2026x");
  });

  it("trims spaces and trailing dots, and collapses empty levels", () => {
    expect(cleanTopicPath("  Travel //  Japan.  ")).toBe("Travel/Japan");
  });

  it("limits depth to 4 levels and each level to 60 characters", () => {
    expect(cleanTopicPath("a/b/c/d/e/f")).toBe("a/b/c/d");
    expect(cleanTopicPath("x".repeat(100))).toBe("x".repeat(60));
  });

  it("returns null when nothing usable is left", () => {
    expect(cleanTopicPath("   ")).toBeNull();
    expect(cleanTopicPath("///")).toBeNull();
  });
});

describe("resolveTopic", () => {
  it("reuses an existing topic regardless of case", () => {
    expect(resolveTopic("travel/JAPAN", ["Work", "Travel/Japan"])).toBe("Travel/Japan");
  });

  it("uses the cleaned path for a new topic, or Inbox when nothing is left", () => {
    expect(resolveTopic("Health/Running", ["Work"])).toBe("Health/Running");
    expect(resolveTopic("??", ["Work"])).toBe("Inbox");
  });
});

describe("noteFileName", () => {
  it("makes a safe file name and adds a number for collisions", () => {
    expect(noteFileName("Kyoto: temples / gardens")).toBe("Kyoto temples gardens.md");
    expect(noteFileName("Kyoto", 2)).toBe("Kyoto 2.md");
    expect(noteFileName("???")).toBe("Untitled.md");
  });
});

describe("renderNote and renderArchive", () => {
  it("writes frontmatter Obsidian can read, with a wikilink to the original", () => {
    const markdown = renderNote({
      id: "n1",
      title: 'Kyoto "spring" trip',
      topic: "Travel/Japan",
      created: "2026-11-03T08:40:00.000Z",
      sourcePath: "_archive/2026/11/2026-11-03 1540 ab12cd34",
      body: "Visit temples.\n",
    });
    expect(markdown).toBe(
      [
        "---",
        'id: "n1"',
        'title: "Kyoto \\"spring\\" trip"',
        'topic: "Travel/Japan"',
        'created: "2026-11-03T08:40:00.000Z"',
        'source: "[[_archive/2026/11/2026-11-03 1540 ab12cd34]]"',
        "---",
        "",
        "Visit temples.",
        "",
      ].join("\n"),
    );
  });

  it("keeps the original text in the archive file", () => {
    expect(renderArchive({ id: "c1", captured: "2026-11-03T08:40:00.000Z", text: "  raw\ntext  " })).toBe(
      '---\nid: "c1"\ncaptured: "2026-11-03T08:40:00.000Z"\n---\n\nraw\ntext\n',
    );
  });
});
