import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { SITE } from "../../src/data/site";

type SetFile = { slug: string; title: string; photos: { slug: string; title: string }[] };
const readSet = (slug: string) =>
  JSON.parse(readFileSync(`content/sets/${slug}.json`, "utf8")) as SetFile;
const set = readSet("superstition-mountains");
const [first, second] = set.photos;
if (!first || !second) throw new Error("superstition-mountains needs at least two photos");
const sets = SITE.setOrder.map(readSet);

async function settle(strip: Locator) {
  let last = Number.NaN;
  let steady = 0;
  for (let i = 0; i < 100 && steady < 3; i += 1) {
    const now = await strip.evaluate((element) => element.scrollLeft);
    steady = now === last ? steady + 1 : 0;
    last = now;
    await strip.page().waitForTimeout(100);
  }
}

/** Presses ArrowRight and waits until the counter moves on from what it read. */
async function pressNext(page: Page) {
  const counter = page.getByTestId("counter");
  const before = (await counter.textContent()) ?? "";
  await page.keyboard.press("ArrowRight");
  await expect(counter).not.toHaveText(before);
}

async function expectTapTargets(controls: Locator, minimum: number) {
  const count = await controls.count();
  expect(count).toBeGreaterThanOrEqual(minimum);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const box = await control.boundingBox();
    const label = (await control.textContent())?.trim() || (await control.getAttribute("aria-label"));
    expect(box, `${label} has a box`).not.toBeNull();
    expect(Math.round(box!.width), `${label} width`).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.height), `${label} height`).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoSeriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe("set page", () => {
  test("shows the strip and passes accessibility checks", async ({ page }) => {
    await page.goto(`/${set.slug}`);
    await expect(page).toHaveTitle(`${set.title} — Digital Hitchhiker`);
    await expect(page.getByRole("region", { name: `${set.title} photographs` })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("desktop: arrow key and button move one frame", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout only");
    await page.goto(`/${set.slug}`);
    const counter = page.getByTestId("counter");
    await expect(counter).toContainText("01 /");
    await page.getByRole("region", { name: `${set.title} photographs` }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(counter).toContainText("02 /");
    await page.getByRole("button", { name: "Previous photograph" }).click();
    await expect(counter).toContainText("01 /");
  });

  test("desktop: frames sit side by side", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout only");
    await page.goto(`/${set.slug}`);
    const a = await page.locator(`#${first.slug}`).boundingBox();
    const b = await page.locator(`#${second.slug}`).boundingBox();
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(Math.abs(b!.y - a!.y)).toBeLessThan(2);
  });

  test("phone: frames stack, footer is hidden, heading is shown", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone layout only");
    await page.goto(`/${set.slug}`);
    const a = await page.locator(`#${first.slug}`).boundingBox();
    const b = await page.locator(`#${second.slug}`).boundingBox();
    expect(b!.y).toBeGreaterThan(a!.y);
    expect(Math.abs(a!.width - 390)).toBeLessThan(2);
    await expect(page.locator(".strip-footer")).toBeHidden();
    await expect(page.locator(".set-heading h1")).toHaveText(set.title);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("desktop: Back from a photograph returns the strip to where it was", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout only");
    expect(set.photos.length).toBeGreaterThanOrEqual(4);
    await page.goto(`/${set.slug}`);
    const strip = page.getByRole("region", { name: `${set.title} photographs` });
    const counter = page.getByTestId("counter");
    await strip.focus();
    for (let i = 0; i < 3; i += 1) await pressNext(page);
    await expect(counter).toContainText("04 /");
    await settle(strip);
    await page.locator("[data-frame]").nth(3).click();
    await expect(page).toHaveURL(new RegExp(`/${set.slug}/${set.photos[3]!.slug}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${set.slug}$`));
    await expect(counter).toContainText("04 /");
  });

  for (const each of sets) {
    test(`desktop: Next reaches the last photograph of ${each.slug}`, async ({ page }, testInfo) => {
      test.skip(!["desktop", "tablet"].includes(testInfo.project.name), "horizontal strip only");
      const total = String(each.photos.length).padStart(2, "0");
      const last = `${total} / ${total}`;
      // Instant scrolling keeps this about where the strip stops, not how
      // fast a smooth scroll runs on a loaded machine.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/${each.slug}`);
      const counter = page.getByTestId("counter");
      await page.getByRole("region", { name: `${each.title} photographs` }).focus();
      // Up to (photo count + 1) presses; every press short of the last
      // photograph must move the counter on.
      for (let i = 0; i < each.photos.length + 1; i += 1) {
        if ((await counter.textContent())?.startsWith(last)) break;
        await pressNext(page);
      }
      await expect(counter).toContainText(last);
    });
  }

  test("desktop: zoom gestures over the strip are not blocked", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout only");
    await page.goto(`/${set.slug}`);
    const strip = page.getByRole("region", { name: `${set.title} photographs` });
    const prevented = (ctrlKey: boolean) =>
      strip.evaluate((element, ctrl) => {
        const event = new WheelEvent("wheel", {
          deltaY: 100,
          ctrlKey: ctrl,
          cancelable: true,
          bubbles: true,
        });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }, ctrlKey);
    expect(await prevented(true)).toBe(false);
    expect(await prevented(false)).toBe(true);
  });

  test("phone: following the next-set link starts the new page at the top", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone layout only");
    const [firstSet, secondSet] = sets;
    await page.goto(`/${firstSet!.slug}`);
    const link = page.getByRole("link", { name: `Next set: ${secondSet!.title}` });
    await link.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${secondSet!.slug}$`));
    await expect(page.locator(".set-heading h1")).toHaveText(secondSet!.title);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.locator(".set-heading h1")).toBeInViewport();
  });

  test("phone held sideways: frames stack and the footer is hidden", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone-landscape", "phone-landscape layout only");
    await page.goto(`/${set.slug}`);
    const a = await page.locator(`#${first.slug}`).boundingBox();
    const b = await page.locator(`#${second.slug}`).boundingBox();
    expect(b!.y).toBeGreaterThan(a!.y);
    expect(Math.abs(a!.width - 844)).toBeLessThan(2);
    await expect(page.locator(".strip-footer")).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("every header and footer control is at least 44 by 44 CSS pixels", async ({ page }) => {
    await page.goto(`/${set.slug}`);
    await expectTapTargets(
      page.locator(
        "header a:visible, header button:visible, .strip-footer a:visible, .strip-footer button:visible",
      ),
      2,
    );
  });

  test("phone: menu opens and navigates", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone layout only");
    await page.goto(`/${set.slug}`);
    await page.getByRole("button", { name: "Photo sets" }).click();
    await page.getByRole("navigation", { name: "Photo sets" }).getByRole("link", { name: "Phoenix Zoo" }).click();
    await expect(page).toHaveURL(/\/phoenix-zoo$/);
    await expect(page).toHaveTitle("Phoenix Zoo — Digital Hitchhiker");
  });
});

test.describe("header", () => {
  test("no header label wraps and the page does not scroll sideways", async ({ page }) => {
    await page.goto(`/${set.slug}`);
    const toggle = page.getByRole("button", { name: "Photo sets" });
    if (await toggle.isVisible()) await toggle.click();
    const labels = page.locator("header a:visible");
    const count = await labels.count();
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i += 1) {
      const text = (await labels.nth(i).textContent())?.trim();
      const lines = await labels.nth(i).evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const tops = new Set<number>();
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top));
          }
        }
        return tops.size;
      });
      expect(lines, `"${text}" should be on one line`).toBeLessThanOrEqual(1);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("tablet: menu button replaces inline links while the strip stays horizontal", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "tablet", "tablet layout only");
    await page.goto(`/${set.slug}`);
    await expect(page.getByRole("button", { name: "Photo sets" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Photo sets" })).toBeHidden();
    await expect(page.locator(".strip-footer")).toBeVisible();
    const a = await page.locator(`#${first.slug}`).boundingBox();
    const b = await page.locator(`#${second.slug}`).boundingBox();
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(Math.abs(b!.y - a!.y)).toBeLessThan(2);
  });

  test("desktop: links are inline and the menu button is hidden", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop layout only");
    await page.goto(`/${set.slug}`);
    await expect(page.getByRole("button", { name: "Photo sets" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Photo sets" })).toBeVisible();
  });
});

test.describe("photo page", () => {
  test("opens, moves next, and closes back to the strip", async ({ page }) => {
    await page.goto(`/${set.slug}/${first.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(first.title);
    await expectNoSeriousViolations(page);
    await page.getByRole("link", { name: "Next photograph" }).click();
    await expect(page).toHaveURL(new RegExp(`/${set.slug}/${second.slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(second.title);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/${set.slug}#${second.slug}$`));
  });

  test("opens from a click on a frame", async ({ page }) => {
    await page.goto(`/${set.slug}`);
    await page.locator(`#${first.slug}`).click();
    await expect(page).toHaveURL(new RegExp(`/${set.slug}/${first.slug}$`));
  });

  test("every control is at least 44 by 44 CSS pixels", async ({ page }) => {
    await page.goto(`/${set.slug}/${second.slug}`);
    await expectTapTargets(
      page.locator("header a:visible, header button:visible, .photo-nav a:visible"),
      4,
    );
  });
});

test("colophon shows contact links and passes accessibility checks", async ({ page }) => {
  await page.goto("/colophon");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Colophon");
  await expect(page.getByRole("link", { name: "digitalhitchhikers@gmail.com" })).toHaveAttribute(
    "href",
    "mailto:digitalhitchhikers@gmail.com",
  );
  await expectNoSeriousViolations(page);
});

test("unknown address returns the 404 page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
  await expectNoSeriousViolations(page);
});

test("pages hydrate without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // The browser reports the unknown path's own 404 status, which is intended.
    const expected404 =
      message.location().url.endsWith("/no-such-page") && message.text().includes("status of 404");
    if (!expected404) errors.push(`${page.url()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
  for (const path of [
    "/",
    `/${sets[1]!.slug}`,
    `/${set.slug}#${second.slug}`,
    `/${set.slug}/${first.slug}`,
    "/colophon",
    "/no-such-page",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});
