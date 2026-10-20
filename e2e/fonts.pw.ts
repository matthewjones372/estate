import { expect, test } from "@playwright/test"

test("the pages draw in their own fonts, asking no host but Estate's for them", async ({ page }) => {
  const hosts = new Set<string>()
  page.on("request", (request) => hosts.add(new URL(request.url()).host))
  await page.goto("/services/storefront?env=production")
  await expect(page.getByRole("region", { name: "Logs" }).locator(".log-line").first()).toBeVisible({ timeout: 20_000 })
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family.replaceAll('"', ""))
  })
  expect(loaded.toSorted()).toEqual(["Instrument Sans", "JetBrains Mono"])
  expect([...hosts]).toEqual(["127.0.0.1:8181"])
})
