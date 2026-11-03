import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** A passphrase no other test uses, so every test starts with its own empty org. */
export const uniquePassphrase = (label: string) => `${label} ${randomUUID()}`;

/** The main menu (Chat / Add Notes / Pending / Settings); other links with the same names exist on some pages. */
export const menu = (page: Page) => page.getByRole("navigation", { name: "Main" });

export async function signIn(page: Page, passphrase: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(menu(page).getByRole("link", { name: "Settings" })).toBeVisible();
}

interface ContrastProblem {
  text: string;
  ratio: number | null;
  color: string;
  background: string;
}

/**
 * Fails when visible text is hard to read: contrast below 4.5:1 (WCAG AA), or no explicit page
 * background (hosts such as Cursor's browser then paint white behind dark-mode text).
 */
export async function expectReadable(page: Page): Promise<void> {
  const problems = await page.evaluate((): ContrastProblem[] => {
    const parse = (value: string): [number, number, number, number] | null => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    };
    const luminance = ([r, g, b]: number[]) => {
      const channel = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    const effectiveBackground = (element: Element): [number, number, number, number] | null => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg && bg[3] > 0.5) return bg;
      }
      return null;
    };

    const problems: ContrastProblem[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const element = node.parentElement;
      if (!text || !element) continue;
      if (element.closest("button:disabled, [aria-hidden='true']")) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden") continue;

      const fg = parse(style.color);
      const bg = effectiveBackground(element);
      if (!fg || !bg) {
        problems.push({ text, ratio: null, color: style.color, background: bg ? bg.join(",") : "none set" });
        continue;
      }
      const blended = fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i]! * (1 - fg[3]));
      const [hi, lo] = [luminance(blended), luminance(bg)].sort((a, b) => b - a) as [number, number];
      const ratio = (hi + 0.05) / (lo + 0.05);
      if (ratio < 4.5) problems.push({ text, ratio: Math.round(ratio * 100) / 100, color: style.color, background: bg.join(",") });
    }
    return problems;
  });
  expect(problems, "text with too little contrast").toEqual([]);
}

/** Checks readability, then saves e2e/screenshots/<project>-<name>.png for review. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expectReadable(page);
  await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}-${name}.png`, fullPage: true });
}
