/** The overview in Chromium: how long until every lane is drawn, and the page's heap after a collection. */
import { chromium } from "@playwright/test"

export interface PageMeasured {
  readonly drawnMs: number
  readonly heapMB: number
}

export const measurePage = async (url: string, lanes: number): Promise<PageMeasured> => {
  const executablePath = process.env["CHROMIUM"]
  const browser = await chromium.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: ["--enable-precise-memory-info"],
  })
  try {
    const page = await browser.newPage()
    const started = performance.now()
    await page.goto(`${url}/?env=production`)
    await page.waitForFunction((count) => document.querySelectorAll("article.lane").length >= count, lanes, {
      timeout: 120_000,
    })
    const drawnMs = Math.round(performance.now() - started)
    // A few events after drawing, as someone leaving the page open would have.
    await page.waitForTimeout(5000)
    const session = await page.context().newCDPSession(page)
    await session.send("HeapProfiler.collectGarbage")
    const heap = await page.evaluate(
      () => (performance as unknown as { readonly memory: { readonly usedJSHeapSize: number } }).memory.usedJSHeapSize,
    )
    return { drawnMs, heapMB: Math.round(heap / 1e5) / 10 }
  } finally {
    await browser.close()
  }
}
