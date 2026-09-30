import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(here, "fixtures", "out", name);

// The "phone" and "desktop" projects share one wrangler dev server and one
// persisted D1/R2 state for the whole run (see playwright.config.ts), so
// uploading the same two fixture files from both projects would collide on
// the server's content-hash de-duplication — the second project's uploads
// would always be refused as duplicates of the first's. Appending a small
// unique trailer after the JPEG's end-of-image marker changes the file's
// bytes (and hash) without touching the image data itself, so every decoder,
// including the one this admin runs in the browser, still reads it fine.
async function uniqueFixture(name: string, testInfo: TestInfo) {
  const base = await readFile(fixture(name));
  const marker = Buffer.from(`\n${testInfo.testId}`);
  return { name, mimeType: "image/jpeg", buffer: Buffer.concat([base, marker]) };
}

async function noSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function controlsAreLargeEnough(page: Page) {
  const controls = page.locator("a:visible, button:visible, select:visible, input:visible, textarea:visible");
  const count = await controls.count();
  for (let i = 0; i < count; i += 1) {
    const box = await controls.nth(i).boundingBox();
    const name = (await controls.nth(i).getAttribute("aria-label")) ?? (await controls.nth(i).textContent()) ?? "";
    const inProse = await controls.nth(i).evaluate((element) => element.tagName === "A" && element.closest("p") !== null);
    if (inProse) continue;
    expect(Math.round(box!.height), `${name.trim()} height`).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.width), `${name.trim()} width`).toBeGreaterThanOrEqual(44);
  }
}

test("create a category, upload, write text, select, reorder, and hide", async ({ page }, testInfo) => {
  const title = `Test set ${testInfo.project.name}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await noSeriousViolations(page);

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Place").fill("Arizona");
  await page.getByLabel("Description").fill("A set made by the browser test.");
  await page.getByRole("button", { name: "Create" }).click();
  const link = page.getByRole("link", { name: title });
  await expect(link).toBeVisible();
  await expect(page.getByRole("listitem").filter({ has: link }).getByText("Not shown")).toBeVisible();
  await controlsAreLargeEnough(page);

  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("0 of 8 selected. Aim for about six.")).toBeVisible();

  const desert = await uniqueFixture("desert.jpg", testInfo);
  const tower = await uniqueFixture("tower.jpg", testInfo);
  await page.getByLabel("Add photographs").setInputFiles([desert, tower]);
  await expect(page.getByRole("status")).toHaveText("2 added.", { timeout: 30_000 });
  const rest = page.getByRole("region", { name: "Not shown" });
  await expect(rest.getByText("Needs text")).toHaveCount(2);
  await expect(rest.getByRole("img")).toHaveCount(2);
  const loaded = await rest.getByRole("img").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);

  await page.getByLabel("Add photographs").setInputFiles([desert]);
  await expect(page.getByRole("status")).toHaveText("0 added, 1 not added.");
  await expect(page.getByRole("alert")).toContainText("desert.jpg: already in the library");

  for (const [index, text] of [
    { title: "Desert", alt: "An orange field filling the frame", description: "A plain orange field." },
    { title: "Tower", alt: "A blue field filling the frame", description: "A plain blue field." },
  ].entries()) {
    await rest.getByRole("button", { name: "Edit Untitled photograph 1" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (index === 0) {
      await noSeriousViolations(page);
      await controlsAreLargeEnough(page);
    }
    await dialog.getByLabel("Title").fill(text.title);
    await dialog.getByLabel("Alt text").fill(text.alt);
    await dialog.getByLabel("Description").fill(text.description);
    await dialog.getByRole("button", { name: "Approve text" }).click();
    await expect(dialog).toBeHidden();
  }

  await page.getByRole("button", { name: "Show Desert on the site" }).click();
  await page.getByRole("button", { name: "Show Tower on the site" }).click();
  await expect(page.getByText("2 of 8 selected. Aim for about six.")).toBeVisible();
  const shown = page.getByRole("region", { name: "Shown on the site" });
  await expect(shown.getByRole("img")).toHaveCount(2);

  const before = await shown.getByRole("img").evaluateAll((images) => images.map((img) => img.getAttribute("alt")));
  await page.getByRole("button", { name: `Move ${before[0] === "An orange field filling the frame" ? "Desert" : "Tower"} later` }).click();
  await expect
    .poll(() => shown.getByRole("img").evaluateAll((images) => images.map((img) => img.getAttribute("alt"))))
    .toEqual([before[1], before[0]]);

  await noSeriousViolations(page);
  await controlsAreLargeEnough(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("link", { name: "Back to the library" }).click();
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) });
  await expect(row.getByText("2 photographs, 2 selected")).toBeVisible();
  await expect(row.getByText("Live")).toBeVisible();
  await page.getByRole("button", { name: `Hide ${title}` }).click();
  await expect(row.getByText("Hidden")).toBeVisible();
});

test("the API refuses a browser with no identity", async ({ playwright }) => {
  // The project's `use.extraHTTPHeaders` (the dev identity header every other
  // request in this suite relies on) is inherited by a new request context
  // unless explicitly cleared here — without this, "anonymous" would still
  // carry x-dev-email and the request would be authorized.
  const anonymous = await playwright.request.newContext({ baseURL: "http://localhost:8799", extraHTTPHeaders: {} });
  const response = await anonymous.get("/api/categories");
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized", message: "Sign in to continue." });
  await anonymous.dispose();
});
