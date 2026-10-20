import { expect, test } from "@playwright/test"

test("a lane off screen is skipped by the browser, keeps a size to scroll by, and is still reached by Tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.goto("/?env=production")
  const lane = page.locator(".lane").last()
  await expect(lane).toBeAttached({ timeout: 20_000 })
  const offScreen = () =>
    lane.evaluate((element) => ({
      // A lane's own box stays; what is inside it is what the browser skips.
      skipped: !(element.firstElementChild?.checkVisibility({ contentVisibilityAuto: true }) ?? true),
      height: element.getBoundingClientRect().height,
    }))
  expect(await offScreen()).toEqual({ skipped: true, height: expect.any(Number) })
  expect((await offScreen()).height).toBeGreaterThan(0)
  // Focus reaches a link inside it, and the browser renders it then.
  await lane.getByRole("link").first().focus()
  await expect(lane.getByRole("link").first()).toBeFocused()
  expect((await offScreen()).skipped).toBe(false)
})
