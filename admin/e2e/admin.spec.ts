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

// Every control a finger might press is at least 44 by 44. The file input is
// in the page only for the keyboard and screen readers (it is one pixel
// square); what is pressed is its label, so that is what is measured.
async function controlsAreLargeEnough(page: Page) {
  const controls = page.locator(
    "a:visible, button:visible, select:visible, input:visible:not(.upload-input), textarea:visible, label.upload-label:visible",
  );
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

const DESERT = "An orange field filling the frame";
const TOWER = "A blue field filling the frame";

test("create a category, land in it, upload, write text, show, reorder three ways, and hide", async ({ page }, testInfo) => {
  const title = `Test set ${testInfo.project.name}`;

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();

  // An empty library asks for the first category right on the page; after
  // that, a new one is started from a button. Both projects share one
  // library, so the second to run meets the first one's category.
  const create = page.getByRole("button", { name: "Create category" });
  const opener = page.getByRole("button", { name: "New category" }).first();
  await expect(create.or(opener)).toBeVisible();
  await noSeriousViolations(page);
  if (!(await create.isVisible())) await opener.click();
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Place" }).fill("Arizona");
  await page.getByRole("textbox", { name: "Description" }).fill("A set made by the browser test.");
  await controlsAreLargeEnough(page);
  await create.click();

  // Creating a category goes straight into it.
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("0 of 8 shown. Aim for about six.")).toBeVisible();
  await expect(page.getByText("No photographs yet. Add some above.")).toBeVisible();

  const desert = await uniqueFixture("desert.jpg", testInfo);
  const tower = await uniqueFixture("tower.jpg", testInfo);
  const uploadStatus = page.locator(".upload-status");
  await page.getByLabel("Add photographs").setInputFiles([desert, tower]);
  await expect(uploadStatus).toHaveText("2 added.", { timeout: 30_000 });
  const rest = page.getByRole("region", { name: "Not shown" });
  await expect(rest.getByText("Needs text")).toHaveCount(2);
  await expect(rest.getByRole("img")).toHaveCount(2);
  const loaded = await rest.getByRole("img").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);

  await page.getByLabel("Add photographs").setInputFiles([desert]);
  await expect(uploadStatus).toHaveText("0 added, 1 not added.");
  await expect(page.locator(".upload").getByRole("alert")).toContainText("desert.jpg: already in the library");

  // Ticking a photograph that has no text yet asks for the text, then shows it.
  // The newest upload comes first, so the tower is titled before the desert;
  // which is which is read from the file name the editor shows.
  const texts: Record<string, { title: string; alt: string; description: string }> = {
    "desert.jpg": { title: "Desert", alt: DESERT, description: "A plain orange field." },
    "tower.jpg": { title: "Tower", alt: TOWER, description: "A plain blue field." },
  };
  for (const index of [0, 1]) {
    await page.getByRole("button", { name: "Show Untitled photograph 1 on the site" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (index === 0) {
      await noSeriousViolations(page);
      await controlsAreLargeEnough(page);
    }
    const text = (await dialog.getByText("desert.jpg").count()) > 0 ? texts["desert.jpg"]! : texts["tower.jpg"]!;
    await dialog.getByRole("textbox", { name: "Title" }).fill(text.title);
    await dialog.getByRole("textbox", { name: "Alt text" }).fill(text.alt);
    await dialog.getByRole("textbox", { name: "Description" }).fill(text.description);
    await dialog.getByRole("button", { name: "Save and show on the site" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Show ${text.title} on the site` })).toHaveAttribute("aria-pressed", "true");
  }

  await expect(page.getByText("2 of 8 shown. Aim for about six.")).toBeVisible();
  const shown = page.getByRole("region", { name: "Shown on the site" });
  await expect(shown.getByRole("img")).toHaveCount(2);
  const order = () => shown.getByRole("img").evaluateAll((images) => images.map((img) => img.getAttribute("alt")));
  const [first, second] = (await order()) as [string, string];
  const nameOf = (alt: string) => (alt === DESERT ? "Desert" : "Tower");

  // One: with the keyboard, from the photograph's handle.
  // Each step is read out for screen readers, and the test waits for those
  // words the way a person would wait to hear them.
  const handle = page.getByRole("button", { name: `Reorder ${nameOf(first)}` });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(`Picked up ${nameOf(first)}, in position 1 of 2.`)).toBeAttached();
  // The drag library starts listening for the arrow keys a moment after the
  // pick-up, sooner than any person presses one but not always sooner than
  // this test does, so an arrow that lands too early is pressed again. With
  // two photographs a second press has nowhere further to go.
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(`${nameOf(first)} is over position 2 of 2.`)).toBeAttached({ timeout: 500 });
  }).toPass();
  await page.keyboard.press("Space");
  await expect(page.getByText(`${nameOf(first)} was put in position 2 of 2.`)).toBeAttached();
  await expect.poll(order).toEqual([second, first]);
  await expect(handle).toBeFocused();
  await page.reload();
  await expect(shown.getByRole("img")).toHaveCount(2);
  expect(await order()).toEqual([second, first]);

  // Two: without dragging at all, from the editor. With a mouse the editor
  // opens from the pencil that appears over the tile; on a touch screen that
  // pencil is neither shown nor pressable, and tapping the image opens it.
  const pencil = page.getByRole("button", { name: `Edit ${nameOf(first)}` });
  const touchScreen = await page.evaluate(() => window.matchMedia("(hover: none)").matches);
  expect(touchScreen).toBe(testInfo.project.name === "phone");
  if (touchScreen) {
    await expect(pencil).toHaveCSS("pointer-events", "none");
    await shown.getByRole("img", { name: first }).click();
  } else {
    await pencil.click();
  }
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("status")).toHaveText("Position 2 of 2 on the site");
  await editor.getByRole("button", { name: "Move earlier" }).click();
  await expect(editor.getByRole("status")).toHaveText("Position 1 of 2 on the site");
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(editor).toBeHidden();
  await expect.poll(order).toEqual([first, second]);

  // Three: by dragging with a mouse.
  if (testInfo.project.name === "desktop") {
    const from = (await shown.getByRole("img", { name: first }).boundingBox())!;
    const to = (await shown.getByRole("img", { name: second }).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2 + 10, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(order).toEqual([second, first]);
    // A drag is not a click: it must not open the editor.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // Three, on a touch screen: by pressing and holding, then dragging.
  if (testInfo.project.name === "phone") {
    const from = (await shown.getByRole("img", { name: first }).boundingBox())!;
    const to = (await shown.getByRole("img", { name: second }).boundingBox())!;
    const y = from.y + from.height / 2;
    const startX = from.x + from.width / 2;
    const endX = to.x + to.width / 2 + 10;
    const client = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      client.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", startX);
    await expect(page.getByText(`Picked up ${nameOf(first)}, in position 1 of 2.`)).toBeAttached();
    for (let stepIndex = 1; stepIndex <= 10; stepIndex += 1) {
      await touch("touchMove", startX + ((endX - startX) * stepIndex) / 10);
    }
    await touch("touchEnd", endX);
    await expect.poll(order).toEqual([second, first]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }

  // For a twentieth of a second after a drag ends, the drag library discards
  // clicks (the release of a drag must not count as one). Now that a new
  // order shows at once, this test can get here sooner than that, and no
  // person can, so it waits as long as a person would.
  await page.waitForTimeout(150);

  // The tick takes a photograph off the site and puts it back.
  await page.getByRole("button", { name: "Show Desert on the site" }).click();
  await expect(page.getByText("1 of 8 shown. Aim for about six.")).toBeVisible();
  await expect(rest.getByRole("img", { name: DESERT })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Desert on the site" })).toBeFocused();
  await page.getByRole("button", { name: "Show Desert on the site" }).click();
  await expect(page.getByText("2 of 8 shown. Aim for about six.")).toBeVisible();

  await noSeriousViolations(page);
  await controlsAreLargeEnough(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "All", exact: true }).click();
  const row = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) });
  await expect(row.getByText("2 photographs, 2 shown")).toBeVisible();
  await expect(row.getByText("Live")).toBeVisible();
  await expect(row.locator("img")).toHaveJSProperty("complete", true);
  await noSeriousViolations(page);
  await controlsAreLargeEnough(page);
  await page.getByRole("button", { name: `Hide ${title}` }).click();
  await expect(row.getByText("Hidden", { exact: true })).toBeVisible();
  await expect(page.getByText(`${title} is now hidden from the site.`)).toBeAttached();

  // Publish: says what would go out. The test server has no token for
  // starting the workflow, so pressing it shows the refusal, not a publish.
  // Hidden categories are not published, so what is ready is counted first.
  await page.getByRole("button", { name: `Show ${title}` }).click();
  await expect(row.getByText("Live", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Publish/ }).click();
  const publishDialog = page.getByRole("dialog", { name: "Publish" });
  await expect(publishDialog.getByText(/photographs? are ready to go on the site\./)).toBeVisible();
  await expect(publishDialog.getByText("The site has not been published from the library yet.")).toBeVisible();
  await noSeriousViolations(page);
  await controlsAreLargeEnough(page);
  await publishDialog.getByRole("button", { name: "Preview first" }).click();
  await expect(publishDialog.getByRole("alert").first()).toContainText("Publishing is not set up yet");
  await publishDialog.getByRole("button", { name: "Close" }).click();
  await expect(publishDialog).toBeHidden();
  await page.getByRole("button", { name: `Hide ${title}` }).click();
  await expect(row.getByText("Hidden", { exact: true })).toBeVisible();

  // A category row is dragged by its link as readily as by anything else on
  // it. Letting go must put the row down, not follow the link.
  if (testInfo.project.name === "desktop") {
    const rows = page.locator(".rows > li");
    const names = () => rows.getByRole("link").allTextContents();
    const before = await names();
    expect(before.length).toBeGreaterThan(1);
    expect(before.at(-1)).toBe(title);
    const link = page.getByRole("main").getByRole("link", { name: title });
    const from = (await link.boundingBox())!;
    const to = (await rows.first().boundingBox())!;
    await page.mouse.move(from.x + 20, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y + from.height / 2 - 20, { steps: 4 });
    await page.mouse.move(from.x + 20, to.y + 10, { steps: 12 });
    await page.mouse.up();
    await expect.poll(names).toEqual([title, ...before.slice(0, -1)]);
    await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    // And a plain click on the same link still goes there. The new order shows
    // at once, so this test reaches the click within the moment after a drag
    // in which clicks are discarded; a person cannot, so it waits as one would.
    await page.waitForTimeout(150);
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused();
    await expect(page).toHaveTitle(`${title} — Library — Digital Hitchhiker`);
  }
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
