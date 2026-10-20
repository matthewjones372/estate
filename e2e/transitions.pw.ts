import { expect, test } from "@playwright/test"

// Counts the transitions the page starts, so a test can say whether a move cross-faded.
const counting = () => {
  const started = { count: 0 }
  ;(window as unknown as { transitions: typeof started }).transitions = started
  const start = document.startViewTransition?.bind(document)
  if (start !== undefined)
    document.startViewTransition = ((update: () => void) => {
      started.count += 1
      return start(update)
    }) as typeof document.startViewTransition
}
const transitions = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (window as unknown as { transitions: { count: number } }).transitions.count)

test("moving to another page cross-fades, and focus is on the new page", async ({ page }) => {
  await page.addInitScript(counting)
  await page.goto("/?env=production")
  await page.getByRole("navigation").getByRole("link", { name: "Deploys", exact: true }).click({ timeout: 20_000 })
  await expect(page).toHaveTitle("Deploys · Estate")
  expect(await transitions(page)).toBe(1)
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("content")
})

test("for someone who asks for less motion, moving to another page does not fade", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.addInitScript(counting)
  await page.goto("/?env=production")
  await page.getByRole("navigation").getByRole("link", { name: "Deploys", exact: true }).click({ timeout: 20_000 })
  await expect(page).toHaveTitle("Deploys · Estate")
  expect(await transitions(page)).toBe(0)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("content")
})
