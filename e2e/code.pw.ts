import { expect, test } from "@playwright/test"

test("a service's code health is under its name, linking to its tools, in amber for a high alert", async ({ page }) => {
  await page.goto("/?env=production")
  const estate = page.getByRole("region", { name: "The estate by area" })
  const storefront = estate.locator("article", { has: page.getByRole("link", { name: "storefront", exact: true }) })
  const line = storefront.locator(".code-line")
  await expect(line).toHaveText("code: gate passed · 82% covered · 1 high, 1 medium alerts", { timeout: 30_000 })
  await expect(line).toHaveClass(/needs-look/)
  await expect(line.getByRole("link", { name: "1 high, 1 medium alerts" })).toHaveAttribute(
    "href",
    "https://github.com/example/storefront/security/dependabot",
  )
})
