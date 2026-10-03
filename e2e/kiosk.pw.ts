import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("a screen signs in with the kiosk token, shows each environment in turn, and has nothing to press", async ({
  page,
}) => {
  await page.goto("/kiosk?token=e2e-screen")
  await expect(page).toHaveURL(/\/kiosk\?env=production$/)
  const kiosk = page.getByRole("main", { name: /The estate on a screen/ })
  await expect(kiosk).toHaveAccessibleName("The estate on a screen: Production, three machines")
  await expect(kiosk.getByRole("region", { name: "Services" }).locator(".kiosk-tile")).not.toHaveCount(0)
  await expect(kiosk.getByRole("region", { name: "Firing" })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator("button, input, textarea, a")).toHaveCount(0)
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(violations.map((violation) => violation.id)).toEqual([])
  await expect(kiosk).toHaveAccessibleName(/^The estate on a screen: Staging/, { timeout: 25_000 })
})

test("a wrong kiosk token is refused", async ({ page }) => {
  const response = await page.goto("/kiosk?token=guess")
  expect(response?.status()).toBe(403)
})
