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

test("a service found in Backstage is on the overview with its owner's links, and its page says where it was found", async ({
  page,
}) => {
  await page.goto("/?env=production")
  const estate = page.getByRole("region", { name: "The estate by area" })
  const found = estate.locator("article", { has: page.getByRole("link", { name: "recommendations", exact: true }) })
  await expect(found).toBeVisible({ timeout: 30_000 })
  await expect(found.getByText("found in Backstage")).toBeVisible()
  await found.getByRole("link", { name: "recommendations", exact: true }).click()
  await expect(page.getByText("Suggests what each customer may want next")).toBeVisible()
  await expect(page.getByText("Found in Backstage, not written in the catalog.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Repo" })).toHaveAttribute(
    "href",
    "https://github.com/example/recommendations",
  )
  await expect(page.getByText("Owned by Web")).toBeVisible()
})
