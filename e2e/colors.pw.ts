import { expect, test } from "@playwright/test"

test("in forced colors a status keeps its colour and a picked line is outlined", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" })
  await page.goto("/services/storefront?env=production")
  const picks = page.getByRole("region", { name: "Logs" }).locator(".log-pick")
  await expect.poll(() => picks.count(), { timeout: 20_000 }).toBeGreaterThan(0)
  await picks.first().click()
  const style = (selector: string, property: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
  // A dot's colour is what it says, so forced colors must not flatten it.
  expect(await style(".dot", "forced-color-adjust")).toBe("none")
  // The picked line's box-shadow is dropped in forced colors; its outline is not.
  expect(await style(".log-line.picked", "outline-style")).toBe("solid")
})

test("scrollbars and controls take the page's colours", async ({ page }) => {
  await page.goto("/?env=production")
  const root = (property: string) =>
    page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name), property)
  expect(await root("scrollbar-color")).not.toBe("auto")
  expect(await root("scrollbar-width")).toBe("thin")
  expect(await root("accent-color")).not.toBe("auto")
})
