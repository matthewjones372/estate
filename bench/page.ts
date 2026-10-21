/**
 * The overview in Chromium: how long until every lane is drawn, and the page's heap after a collection. Each call into
 * the browser has a deadline, since a Chromium that wedges on CI answers none of them and would hang the run.
 */
import { chromium } from "@playwright/test"
import { againIfClosed } from "./again"
import { deadline } from "./wait"

export interface PageMeasured {
  readonly drawnMs: number
  readonly heapMB: number
}

const measureOnce = async (url: string, lanes: number): Promise<PageMeasured> => {
  const executablePath = process.env["CHROMIUM"]
  const browser = await deadline(
    "starting Chromium",
    60_000,
    chromium.launch({
      ...(executablePath === undefined ? {} : { executablePath }),
      args: ["--enable-precise-memory-info"],
    }),
  )
  try {
    const page = await deadline("opening a page", 30_000, browser.newPage())
    const started = performance.now()
    await page.goto(`${url}/?env=production`)
    await page.waitForFunction((count) => document.querySelectorAll("article.lane").length >= count, lanes, {
      timeout: 120_000,
    })
    const drawnMs = Math.round(performance.now() - started)
    // A few events after drawing, as someone leaving the page open would have.
    await page.waitForTimeout(5000)
    const session = await deadline("opening a DevTools session", 30_000, page.context().newCDPSession(page))
    await deadline("collecting the page's garbage", 60_000, session.send("HeapProfiler.collectGarbage"))
    const heap = await deadline(
      "reading the page's heap",
      30_000,
      page.evaluate(
        () =>
          (performance as unknown as { readonly memory: { readonly usedJSHeapSize: number } }).memory.usedJSHeapSize,
      ),
    )
    return { drawnMs, heapMB: Math.round(heap / 1e5) / 10 }
  } finally {
    // A browser that will not close does not undo what it measured; the run's exit takes it with it.
    await deadline("closing Chromium", 30_000, browser.close()).catch((error: unknown) =>
      process.stderr.write(`${(error as Error).message}; going on without it\n`),
    )
  }
}

export const measurePage = (url: string, lanes: number): Promise<PageMeasured> =>
  againIfClosed(
    () => measureOnce(url, lanes),
    (line) => process.stderr.write(`${line}\n`),
  )
