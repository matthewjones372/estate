import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, test } from "@playwright/test"
import { openCards } from "./overview"

/** What a person does to an alert from its card, opened in place among the overview's things (spec 0068). */
const accessible = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze()
  expect(
    violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`),
  ).toEqual([])
}

test("an alert is told to its team on Slack once, and its card then links to the thread", async ({ page }) => {
  await page.goto("/?env=production")
  await openCards(page)
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
  await openCards(page)
  const card = page.getByRole("article").filter({ hasText: "Orders are slow to place" })
  // Among other cards, notes are one line until opened.
  await card.getByRole("button", { name: /Show notes|Add a note/ }).click()
  await card.getByRole("textbox", { name: /Add a note/ }).fill("Looking: the payment provider is slow")
  await card.getByRole("button", { name: "Add note" }).click()
  await expect(card.locator(".note-body").getByText("Looking: the payment provider is slow")).toBeVisible()
  await page.reload()
  await openCards(page)
  const again = page.getByRole("article").filter({ hasText: "Orders are slow to place" })
  await again.getByRole("button", { name: "Show notes" }).click()
  await expect(again.locator(".note-body").getByText("Looking: the payment provider is slow")).toBeVisible()
})

test("an alert silenced with a reason leaves the cards, and comes back when unsilenced", async ({ page }) => {
  await page.goto("/?env=production")
  await openCards(page)
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
