import { expect, test, type Page } from "@playwright/test";
import { screenshot, signIn, uniquePassphrase } from "./helpers.ts";

const FAKE_AI = "http://127.0.0.1:3199";

async function fillProfileForm(
  page: Page,
  form: string,
  fields: { name?: string; url?: string; model?: string; apiKey?: string },
): Promise<void> {
  const scope = page.getByRole("form", { name: form });
  if (fields.name !== undefined) await scope.getByLabel("Name").fill(fields.name);
  if (fields.url !== undefined) await scope.getByLabel("URL").fill(fields.url);
  if (fields.model !== undefined) await scope.getByLabel("Model").fill(fields.model);
  if (fields.apiKey !== undefined) await scope.getByLabel("API key").fill(fields.apiKey);
}

test("add, test, edit, switch and delete AI connections", async ({ page, browser }, testInfo) => {
  const passphrase = uniquePassphrase("settings");
  await signIn(page, passphrase);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "AI connections" })).toBeVisible();
  await expect(page.getByText("No connections yet.")).toBeVisible();
  await screenshot(page, testInfo, "settings-empty");

  // First connection: Responses API through a base URL.
  await page.getByRole("button", { name: "Add connection" }).click();
  const newForm = page.getByRole("form", { name: "New connection" });
  const save = newForm.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();

  await fillProfileForm(page, "New connection", { name: "Fake Responses", url: "not a url", model: "fake-model" });
  await expect(newForm.getByText('Not a valid URL: "not a url"')).toBeVisible();
  await expect(save).toBeDisabled();

  await fillProfileForm(page, "New connection", { url: `${FAKE_AI}/v1/`, apiKey: "good-key-responses-1234" });
  await expect(newForm.getByText(`Will call: ${FAKE_AI}/v1/responses (Responses API)`)).toBeVisible();
  await screenshot(page, testInfo, "settings-form");
  await save.click();

  const first = page.getByRole("listitem", { name: "Fake Responses" });
  await expect(first.getByText("Active")).toBeVisible();
  await expect(first.getByText("…1234")).toBeVisible();
  await expect(page.getByText("good-key-responses-1234")).toHaveCount(0);

  await first.getByRole("button", { name: "Test" }).click();
  await expect(first.getByText(/Connected: replied "OK" in \d+ ms\./)).toBeVisible();

  // Second connection: Chat Completions endpoint with a wrong key.
  await page.getByRole("button", { name: "Add connection" }).click();
  await fillProfileForm(page, "New connection", {
    name: "Fake Chat",
    url: `${FAKE_AI}/v1/chat/completions`,
    model: "fake-chat",
    apiKey: "bad-key-chat-9999",
  });
  await expect(
    page.getByText(`Will call: ${FAKE_AI}/v1/chat/completions (Chat Completions API)`),
  ).toBeVisible();
  await page.getByRole("form", { name: "New connection" }).getByRole("button", { name: "Save" }).click();

  const second = page.getByRole("listitem", { name: "Fake Chat" });
  await expect(second.getByText("Active")).toHaveCount(0);
  await second.getByRole("button", { name: "Test" }).click();
  await expect(second.getByText("Failed: 401: Invalid API key")).toBeVisible();
  await screenshot(page, testInfo, "settings-test-results");

  // Fix the key; leaving the key empty on a later edit keeps it.
  await second.getByRole("button", { name: "Edit" }).click();
  const editForm = page.getByRole("form", { name: "Edit Fake Chat" });
  await expect(editForm.getByLabel("API key")).toHaveAttribute("placeholder", /keep the current key \(…9999\)/);
  await fillProfileForm(page, "Edit Fake Chat", { apiKey: "good-key-chat-5678" });
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(second.getByText("…5678")).toBeVisible();

  await second.getByRole("button", { name: "Edit" }).click();
  await fillProfileForm(page, "Edit Fake Chat", { name: "Fake Chat (fixed)" });
  await page.getByRole("form", { name: "Edit Fake Chat" }).getByRole("button", { name: "Save" }).click();
  const fixed = page.getByRole("listitem", { name: "Fake Chat (fixed)" });
  await expect(fixed.getByText("…5678")).toBeVisible();
  await fixed.getByRole("button", { name: "Test" }).click();
  await expect(fixed.getByText(/Connected: replied "OK"/)).toBeVisible();

  // Switch the active connection.
  await fixed.getByRole("button", { name: "Use this one" }).click();
  await expect(fixed.getByText("Active")).toBeVisible();
  await expect(first.getByText("Active")).toHaveCount(0);
  await expect(first.getByRole("button", { name: "Use this one" })).toBeVisible();

  // Delete asks first; cancelling keeps the connection.
  page.once("dialog", (dialog) => dialog.dismiss());
  await first.getByRole("button", { name: "Delete" }).click();
  await expect(first).toBeVisible();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe('Delete the connection "Fake Responses"?');
    void dialog.accept();
  });
  await first.getByRole("button", { name: "Delete" }).click();
  await expect(first).toHaveCount(0);

  // Everything is saved on the server.
  await page.reload();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("listitem", { name: "Fake Chat (fixed)" }).getByText("Active")).toBeVisible();
  await screenshot(page, testInfo, "settings-final");

  // Another org sees none of it.
  const other = await browser.newPage();
  await signIn(other, uniquePassphrase("other org"));
  await other.getByRole("link", { name: "Settings" }).click();
  await expect(other.getByText("No connections yet.")).toBeVisible();
  await other.close();
});

test("the menu shows which page you are on", async ({ page }) => {
  await signIn(page, uniquePassphrase("menu"));
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByText("Signed in.")).toBeVisible();
});
