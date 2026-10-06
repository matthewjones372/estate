import { expect, test } from "@playwright/test"

test("a service found in the cluster is on the overview, marked as found, with its load", async ({ page }) => {
  await page.goto("/?env=production")
  const estate = page.getByRole("region", { name: "The estate by area" })
  const basket = estate.locator("article", { has: page.getByRole("link", { name: "basket", exact: true }) })
  await expect(basket).toBeVisible({ timeout: 30_000 })
  await expect(basket.getByText("found in Kubernetes")).toBeVisible()
  await expect(basket.getByText(/\/s$/).first()).toBeVisible({ timeout: 20_000 })
  await basket.getByRole("link", { name: "basket", exact: true }).click()
  await expect(page.getByText("Keeps what each customer means to buy")).toBeVisible()
  await expect(page.getByText("Found in Kubernetes, not written in the catalog.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Copy as YAML" })).toBeVisible()
})
