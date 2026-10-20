import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("a keyboard skips the header to the page, and a wide table takes focus to scroll", async ({ page }) => {
  await page.goto("/deploys?env=production")
  const table = page.getByRole("region", { name: "What runs in each environment" })
  await expect(table.getByRole("table")).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveTitle("Deploys · Estate")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("link", { name: "Skip to the page" })).toBeFocused()
  await page.keyboard.press("Enter")
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("content")
  // The table scrolls sideways on a narrow screen, so the arrow keys need it focusable.
  await expect(table).toHaveAttribute("tabindex", "0")
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(violations.map((violation) => violation.id)).toEqual([])
})
