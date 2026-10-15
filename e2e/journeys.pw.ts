import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

const accessible = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`),
  ).toEqual([])
}

test("a journey opens from its service's links, and a trace from it sets each step against the usual", async ({
  page,
}) => {
  await page.goto("/?env=production")
  await page.locator("a.link-chip", { hasText: "Placing an order" }).first().click()
  await expect(page).toHaveURL(/\/services\/storefront\?/)
  const panel = page.getByRole("region", { name: "Placing an order" })
  await expect(panel.getByRole("button", { name: "Hide" })).toBeVisible({ timeout: 20_000 })
  await expect(panel).toContainText("Waits in the outbox is")
  await expect(panel.getByRole("button", { name: /^Typical/ })).toHaveAttribute("aria-pressed", "true")
  await accessible(page)

  await panel.getByRole("button", { name: /^Slowest ·/ }).click()
  await panel.getByRole("link", { name: "Open this trace, as a waterfall too" }).click()
  await expect(page).toHaveURL(/\/journeys\/checkout\/c0ffee04/)
  const wait = page.getByRole("button", { name: /^Waits in the outbox, Postgres, 900 ms, [\d.]+× usual$/ })
  await expect(wait).toBeVisible()
  await wait.click()
  await expect(page.getByRole("region", { name: "The chosen step" })).toContainText("the p50 of its recent traces")
  await accessible(page)

  await page.getByRole("button", { name: "Waterfall" }).click()
  await expect(page.getByRole("columnheader", { name: "Against usual" })).toBeVisible()
  await accessible(page)
})
