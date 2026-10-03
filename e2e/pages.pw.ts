import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

const accessible = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`),
  ).toEqual([])
}

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true })

test("the overview lists the environment's services with their links, and reads the sources", async ({ page }) => {
  await page.goto("/?env=staging")
  const services = page.getByRole("region", { name: "Services" })
  await expect(services.getByRole("link", { name: "storefront", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Logs" }).first()).toHaveAttribute("href", /env=staging/)
  await expect(services.getByRole("link", { name: "payments" })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Reading the estate" })).toBeVisible()
  await shot(page, "overview")
  await accessible(page)
})

test("switching environment changes what is listed, and is remembered", async ({ page }) => {
  await page.goto("/?env=staging")
  await page.getByRole("button", { name: /Environment: staging/ }).click()
  await page.getByRole("button", { name: /production/ }).click()
  await expect(
    page.getByRole("region", { name: "Services" }).getByRole("link", { name: "payments", exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/env=production/)
  await page.goto("/")
  await expect(page).toHaveURL(/env=production/)
})

for (const [name, path, heading] of [
  ["deploys", "/deploys", "Across environments"],
  ["alerts", "/alerts", "Alerts"],
  ["service", "/services/storefront", "Debug logging"],
] as const) {
  test(`the ${name} page draws, and is accessible`, async ({ page }) => {
    await page.goto(`${path}?env=production`)
    await expect(page.getByRole("heading", { name: heading })).toBeVisible()
    await shot(page, name)
    await accessible(page)
  })
}
