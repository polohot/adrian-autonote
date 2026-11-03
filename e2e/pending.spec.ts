import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { menu, screenshot, signIn, uniquePassphrase } from "./helpers.ts";

const FAKE_AI = "http://127.0.0.1:3199";

async function addFakeConnection(page: Page): Promise<void> {
  await menu(page).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Add connection" }).click();
  const form = page.getByRole("form", { name: "New connection" });
  await form.getByLabel("Name").fill("Fake");
  await form.getByLabel("URL").fill(`${FAKE_AI}/v1`);
  await form.getByLabel("Model").fill("fake-model");
  await form.getByLabel("API key").fill("good-key-pending-1234");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem", { name: "Fake" }).getByText("Active")).toBeVisible();
  await menu(page).getByRole("link", { name: "Add Notes" }).click();
}

test("unsure pieces wait in Pending until the user chooses, answers or drops them", async ({ page }, testInfo) => {
  await signIn(page, uniquePassphrase("pending"));
  const orgId = await page.evaluate(() => fetch("/api/session").then((r) => r.json()).then((b) => b.org.id as string));
  const vault = join(".e2e-data/vaults", orgId);
  await addFakeConnection(page);

  // Empty state.
  await menu(page).getByRole("link", { name: "Pending" }).click();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
  await menu(page).getByRole("link", { name: "Add Notes" }).click();

  // One confident piece is filed; three unsure ones wait.
  const box = page.getByLabel("Capture");
  await box.fill("Kyoto temples in spring\n\nDentist on Thursday at 4pm\n\nDoctor checkup next month\n\nSomething vague to think about");
  await page.getByRole("button", { name: "Save" }).click();
  const capture = page.locator(".capture").first();
  await expect(capture.getByText("Filed")).toBeVisible();
  await expect(capture.locator(".piece")).toHaveCount(1);
  await expect(capture.getByRole("link", { name: "3 waiting in Pending" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "Pending" })).toContainText("3");
  expect(existsSync(join(vault, "Personal"))).toBe(false);

  await capture.getByRole("link", { name: "3 waiting in Pending" }).click();
  await expect(page.getByRole("heading", { name: "Pending" })).toBeVisible();
  const dentist = page.getByRole("listitem", { name: "Dentist on Thursday at 4pm" });
  await expect(dentist.getByText("Is this appointment for you or for your family?")).toBeVisible();
  await expect(dentist.getByRole("group", { name: "Choices" }).getByRole("button")).toHaveText(["Personal/Health", "Family/Health"]);
  await expect(dentist.getByText("From: Kyoto temples in spring / Dentist on Thursday at 4pm /")).toBeVisible();
  const vague = page.getByRole("listitem", { name: "Something vague to think about" });
  await expect(vague.getByText("Where should this go?")).toBeVisible();
  await screenshot(page, testInfo, "pending-list");

  // Tap a choice.
  await dentist.getByRole("button", { name: "Family/Health" }).click();
  await expect(page.getByText('Filed "Dentist on Thursday at 4pm" in Family/Health.')).toBeVisible();
  await expect(dentist).toHaveCount(0);
  await expect(menu(page).getByRole("link", { name: "Pending" })).toContainText("2");
  expect(existsSync(join(vault, "Family/Health/Dentist on Thursday at 4pm.md"))).toBe(true);

  // Answer in your own words.
  const doctor = page.getByRole("listitem", { name: "Doctor checkup next month" });
  await doctor.getByLabel("Your answer").fill("it's for my son");
  await doctor.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText('Filed "Doctor checkup next month" in Family/Kids.')).toBeVisible();
  expect(existsSync(join(vault, "Family/Kids/Doctor checkup next month.md"))).toBe(true);
  await screenshot(page, testInfo, "pending-after-answer");

  // Don't save asks first; cancelling keeps it.
  page.once("dialog", (dialog) => dialog.dismiss());
  await vague.getByRole("button", { name: "Don't save" }).click();
  await expect(vague).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await vague.getByRole("button", { name: "Don't save" }).click();
  await expect(page.getByText('"Something vague to think about" was not saved.')).toBeVisible();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "Pending" })).toHaveText("Pending");

  // The activity feed now shows the filed pieces and nothing waiting.
  await menu(page).getByRole("link", { name: "Add Notes" }).click();
  await expect(capture.locator(".piece")).toHaveCount(3);
  await expect(capture.getByRole("link", { name: /waiting in Pending/ })).toHaveCount(0);
  await screenshot(page, testInfo, "pending-feed-after");
});

test("undo on a capture also clears its Pending pieces", async ({ page }) => {
  await signIn(page, uniquePassphrase("pending undo"));
  await addFakeConnection(page);
  await page.getByLabel("Capture").fill("Dentist on Friday");
  await page.getByRole("button", { name: "Save" }).click();
  const capture = page.locator(".capture").first();
  await expect(capture.getByRole("link", { name: "1 waiting in Pending" })).toBeVisible();
  await capture.getByRole("button", { name: "Undo" }).click();
  await expect(capture.getByText("Undone")).toBeVisible();
  await menu(page).getByRole("link", { name: "Pending" }).click();
  await expect(page.getByText("Nothing waiting.")).toBeVisible();
});
