import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { menu, screenshot, signIn, uniquePassphrase } from "./helpers.ts";

const FAKE_AI = "http://127.0.0.1:3199";
const VAULTS = ".e2e-data/vaults";

const captureItem = (page: Page, text: string) => page.locator(".capture").filter({ hasText: text });
const pieceLine = (page: Page, title: string) => page.locator(".piece-line").filter({ hasText: title });

async function addFakeConnection(page: Page): Promise<void> {
  await menu(page).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Add connection" }).click();
  const form = page.getByRole("form", { name: "New connection" });
  await form.getByLabel("Name").fill("Fake");
  await form.getByLabel("URL").fill(`${FAKE_AI}/v1`);
  await form.getByLabel("Model").fill("fake-model");
  await form.getByLabel("API key").fill("good-key-capture-1234");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem", { name: "Fake" }).getByText("Active")).toBeVisible();
  await menu(page).getByRole("link", { name: "Home" }).click();
}

test("capture, sort into topics, show, undo and retry", async ({ page }, testInfo) => {
  await signIn(page, uniquePassphrase("capture"));
  const orgId = await page.evaluate(() => fetch("/api/session").then((r) => r.json()).then((b) => b.org.id as string));
  const vault = join(VAULTS, orgId);
  const box = page.getByLabel("Capture");

  // No connection yet: the note is kept and waits.
  await expect(page.getByText("No AI connection yet.")).toBeVisible();
  await expect(page.getByText("Nothing captured yet.")).toBeVisible();
  await screenshot(page, testInfo, "home-empty");

  await box.fill("Buy milk and bread");
  await expect(page.getByText("New org created.")).toBeVisible();
  await box.press("Control+Enter");
  await expect(box).toHaveValue("");
  await expect(page.getByText("New org created.")).toBeHidden();
  const milk = captureItem(page, "Buy milk and bread");
  await expect(milk.getByText("Waiting for an AI connection")).toBeVisible();
  await expect(milk.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(readdirSync(join(vault, "_archive"), { recursive: true }).some((f) => String(f).endsWith(".md"))).toBe(true);
  await screenshot(page, testInfo, "home-waiting");

  // Adding a connection sorts the waiting note.
  await addFakeConnection(page);
  await expect(page.getByText("No AI connection yet.")).toBeHidden();
  await expect(milk.getByText("Filed")).toBeVisible();
  await expect(pieceLine(page, "Buy milk and bread")).toContainText("Shopping");
  await expect(pieceLine(page, "Buy milk and bread").getByText("new topic")).toBeVisible();

  // A mixed capture is split; the existing topic is reused.
  await box.fill("Kyoto temples to see in spring\n\nBuy eggs too");
  await page.getByRole("button", { name: "Save" }).click();
  const mixed = captureItem(page, "Kyoto temples to see in spring");
  await expect(mixed.getByText("Filed")).toBeVisible();
  await expect(mixed.locator(".piece")).toHaveCount(2);
  await expect(pieceLine(page, "Kyoto temples to see in spring")).toContainText("Travel/Japan");
  await expect(pieceLine(page, "Kyoto temples to see in spring").getByText("new topic")).toBeVisible();
  await expect(pieceLine(page, "Buy eggs too")).toContainText("Shopping");
  await expect(pieceLine(page, "Buy eggs too").getByText("new topic")).toHaveCount(0);

  // Low confidence is flagged.
  await box.fill("Call the dentist on Monday");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(pieceLine(page, "Call the dentist on Monday").getByText("unsure")).toBeVisible();

  // Show the note text.
  await pieceLine(page, "Kyoto temples to see in spring").getByRole("button", { name: "Show" }).click();
  await expect(mixed.locator(".note-body")).toHaveText("Kyoto temples to see in spring");
  await screenshot(page, testInfo, "home-feed");

  // The notes are Markdown files in topic folders, linked to the original.
  const kyotoFile = join(vault, "Travel/Japan/Kyoto temples to see in spring.md");
  const kyoto = readFileSync(kyotoFile, "utf8");
  expect(kyoto).toContain('topic: "Travel/Japan"');
  expect(kyoto).toMatch(/source: "\[\[_archive\/\d{4}\/\d{2}\/.+\]\]"/);
  expect(existsSync(join(vault, "Shopping/Buy eggs too.md"))).toBe(true);

  // Undo removes the notes and the folder it created, and keeps the original.
  await mixed.getByRole("button", { name: "Undo" }).click();
  await expect(mixed.getByText("Undone")).toBeVisible();
  await expect(mixed.locator(".piece")).toHaveCount(0);
  expect(existsSync(kyotoFile)).toBe(false);
  expect(existsSync(join(vault, "Travel"))).toBe(false);
  expect(existsSync(join(vault, "Shopping/Buy milk and bread.md"))).toBe(true);
  expect(readdirSync(join(vault, "_archive"), { recursive: true }).filter((f) => String(f).endsWith(".md"))).toHaveLength(3);

  // A reply the app can't use is reported, with Retry.
  await box.fill("BROKEN note");
  await page.getByRole("button", { name: "Save" }).click();
  const broken = captureItem(page, "BROKEN note");
  await expect(broken.getByText("Failed")).toBeVisible();
  await expect(broken.getByText(/could not be used twice/)).toBeVisible();
  await expect(broken.getByRole("button", { name: "Retry" })).toBeVisible();
  await screenshot(page, testInfo, "home-failed-and-undone");

  // Everything survives a reload.
  await page.reload();
  await expect(captureItem(page, "Buy milk and bread").getByText("Filed")).toBeVisible();
  await expect(captureItem(page, "Kyoto temples to see in spring").getByText("Undone")).toBeVisible();
  await expect(page.locator(".capture")).toHaveCount(4);
});

test("the Save button stays disabled for an empty capture", async ({ page }) => {
  await signIn(page, uniquePassphrase("empty capture"));
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByLabel("Capture").fill("   ");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});
