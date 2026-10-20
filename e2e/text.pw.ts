import { expect, test } from "@playwright/test"

test("text follows the browser's text size", async ({ page }) => {
  await page.goto("/services/storefront?env=production")
  const line = page.getByRole("region", { name: "Logs" }).locator(".log-line").first()
  await expect(line).toBeVisible({ timeout: 20_000 })
  // A person's default text size is the root's; 20px stands in for one set larger than the usual 16px.
  await page.addStyleTag({ content: "html { font-size: 20px }" })
  const size = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).fontSize)
  expect(await size("body")).toBe("17.5px")
  expect(await size(".log-lines")).toBe("15px")
  // A line's time grows with it rather than being cut to an ellipsis.
  const time = line.locator(".log-at")
  expect(await time.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})
