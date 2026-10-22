/** Getting at what the overview folds away (spec 0068): alerts' cards under their rows, and healthy lanes. */
import { expect, type Page } from "@playwright/test"

/** Each opened toggle is renamed, so the first still named to open is always the next. */
const pressAll = async (page: Page, name: RegExp) => {
  const closed = page.getByRole("button", { name })
  while ((await closed.count()) > 0) await closed.first().click()
}

/** Every alert's card, opened in place from its row among the things that need you. */
export const openCards = async (page: Page) => {
  await expect(page.getByRole("heading", { name: /need(s)? you$/ })).toBeVisible({ timeout: 20_000 })
  await pressAll(page, /Open .*'s card$/)
}

/** Every area's healthy services and stores, as lanes rather than a line of links. */
export const showLanes = async (page: Page) => {
  await expect(page.locator(".healthy-line").first()).toBeVisible({ timeout: 30_000 })
  await pressAll(page, /^Show their lanes/)
}
