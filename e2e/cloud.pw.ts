import { expect, test } from "@playwright/test"
import { openCards } from "./overview"

// The second estate, on other kinds of tool: e2e/cloud.yaml against e2e/cloud-tools.ts.
const cloud = "http://127.0.0.1:8183"

// These act on alerts' cards, which a viewer chooses over the rows shown first (spec 0065).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("estate.alerts.layout", "cards"))
})

test("on EKS: Grafana's alert with its chart, Argo CD's stall in its words, and a silence written to Grafana", async ({
  page,
}) => {
  await page.goto(`${cloud}/?env=eks`)
  await openCards(page)
  const card = page.getByRole("article").filter({ hasText: "Storefront is failing requests" })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByRole("img").first()).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByText("stalled: one or more objects failed to apply: admission webhook denied the request", {
      exact: true,
    }),
  ).toBeVisible()
  await card.getByRole("button", { name: "Silence…" }).click()
  await card.getByRole("button", { name: "6 hours" }).click()
  await card.getByRole("textbox", { name: /Why/ }).fill("rolling back the webhook")
  await card.getByRole("button", { name: /Silence until/ }).click()
  await expect(page.getByText(/silenced until .* by visitor: “rolling back the webhook”/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/silenced until .* by visitor: “rolling back the webhook”/)).toBeVisible({
    timeout: 20_000,
  })
})

test("on EKS: a service's lines from Elasticsearch, and its builds from GitLab", async ({ page }) => {
  await page.goto(`${cloud}/services/storefront?env=eks`)
  await expect(page.getByText("from Elasticsearch")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("card declined by the provider").first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Basket badge" })).toBeVisible()
})

test("on ECS: CloudWatch's alarm with its chart, ECS's failed rollout, tasks, a scheduled task and GitLab's failed job", async ({
  page,
}) => {
  await page.goto(`${cloud}/?env=aws`)
  await openCards(page)
  const card = page.getByRole("article").filter({ hasText: "Checkout is using most of its CPU" })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByRole("img").first()).toBeVisible({ timeout: 10_000 })
  await expect(card.getByRole("button", { name: "Silence…" })).toHaveCount(0)
  await expect(
    page.getByText("stalled: ECS deployment circuit breaker: tasks failed to start.", { exact: true }),
  ).toBeVisible()
  await page.getByRole("link", { name: "checkout", exact: true }).first().click()
  await expect(page.getByText("checkout-nightly-export")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("2/2 pods")).toBeVisible()
  await expect(page.getByText(/failure at integration-tests/)).toBeVisible()
})

test("on Datadog: a monitor with its chart, silenced with a downtime, a service's lines, and its builds from Jenkins", async ({
  page,
}) => {
  await page.goto(`${cloud}/?env=datadog`)
  await openCards(page)
  const card = page.getByRole("article").filter({ hasText: "Payments are slower than customers wait for" })
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByRole("img").first()).toBeVisible({ timeout: 10_000 })
  await card.getByRole("button", { name: "Silence…" }).click()
  await card.getByRole("button", { name: "1 hour" }).click()
  await card.getByRole("textbox", { name: /Why/ }).fill("the card provider is down")
  await card.getByRole("button", { name: /Silence until/ }).click()
  await page.reload()
  await expect(page.getByText(/silenced until .* by visitor: “the card provider is down”/)).toBeVisible({
    timeout: 20_000,
  })
  await page.goto(`${cloud}/services/payments?env=datadog`)
  await expect(page.getByText("from Datadog")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("card ••• declined by the provider").first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Retry the card provider" })).toBeVisible()
})

test("on Datadog: a service built by TeamCity, and Harness's failed deployment as a stall", async ({ page }) => {
  await page.goto(`${cloud}/?env=datadog`)
  await openCards(page)
  await expect(page.getByText("stalled: Deployment exceeded progress deadline").first()).toBeVisible({
    timeout: 20_000,
  })
  await page.goto(`${cloud}/services/ledger?env=datadog`)
  await expect(page.getByRole("link", { name: "Post refunds to the ledger" })).toBeVisible({ timeout: 20_000 })
  await page.goto(`${cloud}/deploys?env=datadog`)
  await expect(page.getByText("v4.1.9").first()).toBeVisible({ timeout: 20_000 })
})
