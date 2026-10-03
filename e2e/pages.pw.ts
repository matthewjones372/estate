import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"

const accessible = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`),
  ).toEqual([])
}

const shot = (page: Page, name: string) => page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true })

const services = (page: Page) => page.getByRole("region", { name: "The estate by area" })

test("the overview says what needs someone, with each service's lane and what changed", async ({ page }) => {
  await page.goto("/?env=production")
  await expect(page.getByRole("heading", { name: /Two things\s*need you\./ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "Orders are slow to place" })).toBeVisible()
  // The owners' chat, on the card of an alert about their service.
  await expect(page.getByRole("link", { name: "Orders on Slack" })).toHaveAttribute(
    "href",
    "https://example.slack.com/archives/C0ORDERS",
  )
  await expect(services(page).getByRole("link", { name: "storefront", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "API" })).toHaveAttribute(
    "href",
    "https://storefront.production.example.com/swagger-ui",
  )
  await expect(page.getByText("orders job orders-nightly-export succeeded")).toBeVisible()
  // The catalog's categories, in its order, and what has none last.
  await expect(services(page).getByRole("heading", { level: 2 })).toHaveText(["Shop", "Payments", "Everything else"])
  await expect(page.getByRole("region", { name: "Payments" }).getByRole("link", { name: "orders-db" })).toBeVisible()
  // A job no service owns, in its category, with its schedule and last run.
  const settlement = page.getByRole("article", { name: "settlement, a job" })
  await expect(settlement).toContainText("0 1 * * *")
  await expect(settlement).toContainText("succeeded")
  await expect(
    page.getByRole("region", { name: "Payments" }).getByRole("article", { name: "settlement, a job" }),
  ).toBeVisible()
  await shot(page, "overview")
  await accessible(page)
})

test("an alert says what it means for users, from its rule or the catalog, and an operator rewrites it", async ({
  page,
}) => {
  await page.goto("/?env=production")
  const search = page.getByRole("article").filter({ hasText: "Search has not indexed" })
  await expect(search).toContainText("New products can't be found in search", { timeout: 20_000 })
  const orders = page.getByRole("article").filter({ hasText: "Orders are slow to place" })
  await expect(orders).toContainText("Customers wait to place orders")
  await orders.getByRole("button", { name: "Edit" }).click()
  await orders.getByLabel("What OrdersSlow means for users").fill("Orders take minutes; card payments time out.")
  await orders.getByRole("button", { name: "Save impact" }).click()
  await expect(orders).toContainText("Orders take minutes; card payments time out.")
  await expect(orders).toContainText("visitor")
  await accessible(page)
})

test("a note added to an alert is there for everyone", async ({ page }) => {
  await page.goto("/?env=production")
  const card = page.getByRole("article").filter({ hasText: "Orders are slow to place" })
  await card.getByRole("textbox", { name: /Add a note/ }).fill("Looking: the payment provider is slow")
  await card.getByRole("button", { name: "Add note" }).click()
  await expect(card.getByText("Looking: the payment provider is slow")).toBeVisible()
  await page.reload()
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Orders are slow to place" })
      .getByText("Looking: the payment provider is slow"),
  ).toBeVisible()
})

test("an alert silenced with a reason leaves the cards, and comes back when unsilenced", async ({ page }) => {
  await page.goto("/?env=production")
  const card = page.getByRole("article").filter({ hasText: "Search has not indexed" })
  await card.getByRole("button", { name: "Silence…" }).click()
  await card.getByRole("button", { name: "6 hours" }).click()
  await card.getByRole("textbox", { name: /Why/ }).fill("reindexing tonight")
  await card.getByRole("button", { name: /Silence until/ }).click()
  await expect(page.getByText(/silenced until .* by visitor: “reindexing tonight”/)).toBeVisible()
  await expect(page.getByRole("heading", { name: "Search has not indexed for 40 minutes" })).toHaveCount(0)
  await page.getByRole("button", { name: "Unsilence" }).click()
  await expect(page.getByRole("heading", { name: "Search has not indexed for 40 minutes" })).toBeVisible()
})

test("debug is turned on for a while, under your name, and off again", async ({ page }) => {
  await page.goto("/services/storefront?env=production")
  await expect(page.getByText("Off: it logs at INFO.")).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "15 min" }).click()
  await page.getByRole("button", { name: "Turn on debug…" }).click()
  await page.getByRole("button", { name: "Turn on", exact: true }).click()
  await expect(page.getByText(/On until/)).toBeVisible()
  await expect(page.getByText(/Turned on by visitor/)).toBeVisible()
  await shot(page, "service")
  await accessible(page)
  await page.getByRole("button", { name: "Turn off now" }).click()
  await expect(page.getByText("Off: it logs at INFO.")).toBeVisible()
})

test("switching environment changes what is listed, and is remembered", async ({ page }) => {
  await page.goto("/?env=production")
  await page.getByRole("button", { name: /Environment: production/ }).click()
  await page.getByRole("button", { name: /^staging/ }).click()
  await expect(services(page).getByRole("link", { name: "payments" })).toHaveCount(0)
  await expect(page).toHaveURL(/env=staging/)
  await page.goto("/")
  await expect(page).toHaveURL(/env=staging/)
  await expect(page.getByText(/Not set up here:/)).toBeVisible()
})

for (const [name, path, heading] of [
  ["deploys", "/deploys", "One deploy is stuck."],
  ["alerts", "/alerts", "Alerts"],
] as const) {
  test(`the ${name} page draws, and is accessible`, async ({ page }) => {
    await page.goto(`${path}?env=production`)
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 20_000 })
    await shot(page, name)
    await accessible(page)
  })
}

test("pointing at a chart reads a point on every chart, and dragging zooms them", async ({ page }) => {
  await page.goto("/services/storefront?env=production")
  const p99 = page.getByRole("img", { name: /^p99 over 1h/ })
  await expect(p99).toBeVisible({ timeout: 20_000 })
  const box = await p99.boundingBox()
  if (box === null) throw new Error("p99 is not drawn")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText(/^Requests at \d\d:\d\d$/)).toBeVisible()
  await expect(page.getByText(/^p99 at \d\d:\d\d$/)).toBeVisible()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.getByRole("button", { name: "Show all 1h" }).click()
  await expect(page.getByRole("button", { name: "Show all 1h" })).toHaveCount(0)
})

test("a service's lines arrive live, pause, filter to errors, and its errors group by message", async ({ page }) => {
  await page.goto("/services/storefront?env=production")
  const logs = page.getByRole("region", { name: "Logs" })
  await expect(logs.getByText(/served \/products in \d+ ms/).first()).toBeVisible({ timeout: 20_000 })
  await expect(logs.getByText("from the cluster", { exact: false })).toBeVisible()
  await logs.getByRole("button", { name: "Pause" }).click()
  await expect(logs.getByRole("button", { name: /new lines?|Resume/ })).toBeVisible()
  await logs.getByRole("button", { name: "Errors" }).nth(1).click()
  await expect(logs.getByText(/payment provider timed out/).first()).toBeVisible()
  await expect(logs.getByText(/served \/products/)).toHaveCount(0)
  await logs.getByRole("button", { name: "Errors" }).first().click()
  const group = logs.getByRole("button", { name: /payment provider timed out after ‹n› ms for order ‹n›/ })
  await expect(group).toBeVisible({ timeout: 10_000 })
  await group.click()
  await expect(logs.locator(".examples .log-line").first()).toBeVisible()
  await accessible(page)
})

test("a store opened from the overview shows its stats over a day", async ({ page }) => {
  await page.goto("/?env=production")
  // A store sits under its category, beside the services that use it.
  const payments = page.getByRole("region", { name: "Payments" })
  await expect(payments.getByRole("link", { name: "orders-db", exact: true })).toBeVisible({ timeout: 20_000 })
  await payments.getByRole("link", { name: "orders-db", exact: true }).click()
  await expect(page).toHaveURL(/\/stores\/orders-db/)
  await expect(page.getByRole("heading", { name: "orders-db", level: 1 })).toBeVisible()
  await expect(page.getByText("Healthy")).toBeVisible()
  await page.getByRole("button", { name: "24h" }).click()
  await expect(page.getByText("24h ago").first()).toBeVisible()
  await expect(page.getByRole("img", { name: /Connections used over 24h, now [\d.]+%/ })).toBeVisible()
  await shot(page, "store")
  await accessible(page)
})
