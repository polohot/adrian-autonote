import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** A passphrase no other test uses, so every test starts with its own empty org. */
export const uniquePassphrase = (label: string) => `${label} ${randomUUID()}`;

export async function signIn(page: Page, passphrase: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Passphrase", { exact: true }).fill(passphrase);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Signed in.")).toBeVisible();
}

/** Saves a screenshot to e2e/screenshots/<project>-<name>.png for review. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}-${name}.png`, fullPage: true });
}
