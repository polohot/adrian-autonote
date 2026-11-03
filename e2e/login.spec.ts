import { expect, test } from "@playwright/test";
import { menu, screenshot, signIn, uniquePassphrase } from "./helpers.ts";

test("a new passphrase creates an org, and the same passphrase opens it again", async ({ page, context }, testInfo) => {
  const passphrase = uniquePassphrase("blue whale ภูเขา");

  await page.goto("/");
  const field = page.getByLabel("Passphrase", { exact: true });
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  await expect(field).toHaveAttribute("autocapitalize", "off");
  await expect(field).toHaveAttribute("autocorrect", "off");
  await expect(field).toHaveAttribute("spellcheck", "false");
  await screenshot(page, testInfo, "login");

  await field.fill(`  ${passphrase}  `);
  await continueButton.click();
  await expect(page.getByLabel("Capture")).toBeVisible();
  await expect(page.getByText("New org created.")).toBeVisible();
  await screenshot(page, testInfo, "login-new-org");

  const [cookie] = await context.cookies();
  expect(cookie).toMatchObject({ name: "autonote_session", httpOnly: true, sameSite: "Lax" });
  const firstOrgId = await page.evaluate(() => fetch("/api/session").then((r) => r.json()).then((b) => b.org.id));

  await page.reload();
  await expect(page.getByLabel("Capture")).toBeVisible();
  await expect(page.getByText("New org created.")).toBeHidden();

  await menu(page).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(continueButton).toBeVisible();
  await page.reload();
  await expect(continueButton).toBeVisible();

  await signIn(page, passphrase);
  await expect(page.getByText("New org created.")).toBeHidden();
  const secondOrgId = await page.evaluate(() => fetch("/api/session").then((r) => r.json()).then((b) => b.org.id));
  expect(secondOrgId).toBe(firstOrgId);
});

test("show passphrase toggles the field between hidden and visible", async ({ page }) => {
  await page.goto("/");
  const field = page.getByLabel("Passphrase", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await page.getByLabel("Show passphrase").check();
  await expect(field).toHaveAttribute("type", "text");
});
