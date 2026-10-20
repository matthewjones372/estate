import { expect, test } from "@playwright/test"

// One of each kind of page, each opened whole so its parts draw.
const pages = [
  ["/?env=production", /need you/],
  ["/services/storefront?env=production", /^Logs$/],
  ["/deploys?env=production", /^Across environments$/],
  ["/alerts?env=production", /alerts?/i],
  ["/incidents?env=production", /incidents?/i],
  ["/stores/orders-db?env=production", /orders-db/],
  ["/kiosk?token=e2e-screen", /./],
] as const

for (const [path, heading] of pages) {
  test(`${path} runs under the shell's policy without breaking it`, async ({ page }) => {
    const broken: string[] = []
    await page.exposeFunction("brokePolicy", (said: string) => broken.push(said))
    await page.addInitScript(() =>
      document.addEventListener("securitypolicyviolation", (event) =>
        (window as unknown as { brokePolicy: (said: string) => void }).brokePolicy(
          `${event.violatedDirective} ${event.blockedURI}`,
        ),
      ),
    )
    await page.goto(path)
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 20_000 })
    await page.evaluate(() => document.fonts.ready)
    expect(broken).toEqual([])
  })
}

test("a page on another origin cannot frame Estate", async ({ page }) => {
  await page.setContent('<iframe src="http://127.0.0.1:8181/" title="Estate"></iframe>')
  const framed = page.frames().find((frame) => frame !== page.mainFrame())
  await expect.poll(() => framed?.url()).toMatch(/^chrome-error:/)
})
