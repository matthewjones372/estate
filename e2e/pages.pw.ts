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
  // An AI agent beside the services it helps: its model, its tokens against its budget.
  const agent = page.getByRole("article", { name: "support-triage, an agent" })
  await expect(agent).toContainText("claude-sonnet")
  await expect(agent).toContainText("6.1M of 20M tokens today")
  await agent.getByRole("button", { name: "Recent runs" }).click()
  const runs = agent.getByRole("list", { name: "Recent runs of support-triage" }).getByRole("listitem")
  await expect(runs).toHaveCount(2)
  await expect(runs.first()).toContainText("failed in 31 s: tool search_orders timed out")
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
  // It fired before, as Prometheus remembers, for twenty minutes.
  await expect(search).toContainText("Beforeonce, last 6 d ago for 20 min")
  await search.getByRole("button", { name: "History" }).click()
  await expect(
    search.getByRole("list", { name: "Earlier firings of SearchIndexStale" }).getByRole("listitem"),
  ).toHaveCount(1)
  const orders = page.getByRole("article").filter({ hasText: "Orders are slow to place" })
  await expect(orders).toContainText("Customers wait to place orders")
  await orders.getByRole("button", { name: "Edit" }).click()
  await orders.getByLabel("What OrdersSlow means for users").fill("Orders take minutes; card payments time out.")
  await orders.getByRole("button", { name: "Save impact" }).click()
  await expect(orders).toContainText("Orders take minutes; card payments time out.")
  await expect(orders).toContainText("visitor")
  await accessible(page)
})

test("an alert's own page gathers what is around it, and Ask AI reads it and is kept as a note", async ({ page }) => {
  await page.goto("/?env=production")
  await page.getByRole("link", { name: "OrdersSlow" }).first().click()
  await expect(page).toHaveURL(/\/alerts\//)
  const around = page.getByRole("region", { name: "Around OrdersSlow" })
  // orders' image policy stalled before it fired, and storefront, which calls it, had just been built.
  await expect(around).toContainText(/orders main-[\w-]+ stalled: cannot list tags.*before it fired/, {
    timeout: 20_000,
  })
  await expect(around).toContainText("storefront build passed: Faster product pages")
  await expect(around).toContainText(/orders-db calls (healthy|attention)/)
  await expect(around).toContainText("payment provider timed out")
  await expect(around).toContainText("If p99 is high after a deploy, roll back.")
  await page.getByRole("button", { name: "Ask AI" }).click()
  await expect(page.getByText("orders' new version never rolled out")).toBeVisible()
  await expect(page.getByText("e2e-model · read: Changed · Depends · Errors · Runbook")).toBeVisible()
  await page.getByRole("button", { name: "Keep as note" }).click()
  await expect(page.getByText("Kept as a note.")).toBeVisible()
  await accessible(page)
})

test("a store and an agent are a jump away, from the header's field or with the chord", async ({ page }) => {
  await page.goto("/?env=production")
  const field = page.getByRole("combobox", { name: "Jump to a service, store, job or agent" })
  await field.click()
  await field.fill("orders-db")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/stores\/orders-db/)
  await page.keyboard.press("Control+k")
  await expect(field).toBeFocused()
  await field.fill("support")
  await page.getByRole("option", { name: /support-triage/ }).click()
  await expect(page).toHaveURL(/\/agents\/support-triage/)
  await accessible(page)
})

test("what each entry costs is on its lane and its page, the estimate named as one", async ({ page }) => {
  await page.goto("/?env=production")
  // orders' share of the shared cluster, from OpenCost.
  await expect(page.locator(".lane", { hasText: "orders" }).first()).toContainText("$212 this month", {
    timeout: 20_000,
  })
  // The support agent: yesterday from Anthropic's report, and Estate's estimate of the last hour from its tokens.
  const agent = page.locator(".lane", { hasText: "support-triage" })
  await expect(agent).toContainText("$28.50 yesterday of $150 a day · est. $4.95 in the last hour")
  await page.goto("/services/orders?env=production")
  await expect(page.getByText("$212 this month")).toBeVisible({ timeout: 20_000 })
  await accessible(page)
})

test("an alert is told to its team on Slack once, and its card then links to the thread", async ({ page }) => {
  await page.goto("/?env=production")
  const card = page.getByRole("article").filter({ hasText: "Orders are slow to place" }).first()
  await card.getByRole("button", { name: "Tell Orders on Slack" }).click()
  const thread = card.getByRole("link", { name: "The thread in Slack" })
  await expect(thread).toHaveAttribute("href", /^https:\/\/example\.slack\.com\/archives\/C0ORDERS\/p/, {
    timeout: 20_000,
  })
  await expect(card.getByRole("button", { name: "Tell Orders on Slack" })).toHaveCount(0)
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
  // The page leads with what is firing, so the charts sit below the fold until scrolled to.
  await p99.scrollIntoViewIfNeeded()
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
  for (const name of [/^Warn \d/, /^Info \d/, /^Debug \d/, /^Other \d/])
    await logs.getByRole("button", { name }).click()
  await expect(logs.getByText(/payment provider timed out/).first()).toBeVisible()
  await expect(logs.getByText(/served \/products/)).toHaveCount(0)
  await logs.getByRole("button", { name: "Errors", exact: true }).click()
  const group = logs.getByRole("button", { name: /payment provider timed out after ‹n› ms for order ‹n›/ })
  await expect(group).toBeVisible({ timeout: 10_000 })
  await group.click()
  await expect(logs.locator(".examples .log-line").first()).toBeVisible()
  await accessible(page)
})

test("a service's lines are searched, a range of them picked, and copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/services/storefront?env=production")
  const logs = page.getByRole("region", { name: "Logs" })
  await logs.getByRole("searchbox").fill("served*ms")
  const picks = logs.locator(".log-pick")
  await expect.poll(() => picks.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3)
  await expect(logs.locator(".log-lines mark").first()).toHaveText(/^served .* ms$/)
  await picks.nth(0).click()
  await picks.nth(2).click({ modifiers: ["Shift"] })
  await logs.getByRole("button", { name: "Copy 3 lines" }).click()
  await expect(logs.getByText("Copied 3 lines")).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.split("\n").every((line) => /^\S+\tstorefront-\S+\tINFO\t.*served .* ms$/.test(line))).toBe(true)
  await accessible(page)
})

test("an alert's earlier firing opens from its History, and says what happened then", async ({ page }) => {
  await page.goto("/?env=production")
  const search = page.getByRole("article").filter({ hasText: "Search has not indexed" })
  await search.getByRole("button", { name: "History" }).click({ timeout: 20_000 })
  await search.getByRole("list", { name: "Earlier firings of SearchIndexStale" }).getByRole("link").click()
  await expect(page).toHaveURL(/\/alerts\/[^/]+\/\d{4}-\d\d-\d\dT[\d:.]+Z\?env=production$/)
  await expect(page.getByRole("heading", { name: "What happened" })).toBeVisible()
  await expect(page.getByText(/fired .* for 20 min, ended .* · search · production/)).toBeVisible()
  await expect(page.getByRole("heading", { name: "Errors then" })).toBeVisible()
  await expect(page.getByRole("img", { name: /^Requests over the firing/ })).toBeVisible()
  await expect(page.locator(".plot-firing")).toHaveCount(3)
  await shot(page, "firing")
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
