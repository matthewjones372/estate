/** @jsxImportSource solid-js */
/** A service's errors over the last day on its page, in happy-dom: run by `errors-day.test.ts`. */
import { describe, expect, jest, test } from "bun:test"
import { createSignal } from "solid-js"
import type { ErrorGroups } from "../shared/log-events"
import type { Actions } from "./context"
import { groups } from "./fixture-logs"
import { mount } from "./harness"
import { ServicePage } from "./pages/Service"
import { recording } from "./recording"
import type { LogsShown } from "./route"

/** The Logs panel, apart from the load's own range buttons. */
const logsOf = (container: HTMLElement) => {
  const found = container.querySelector<HTMLElement>("section[aria-labelledby=logs]")
  if (found === null) throw new Error("no Logs panel")
  return found
}

/** What is chosen in the Logs panel: its view, and the errors' range, apart from the levels shown. */
const pressed = (container: HTMLElement) =>
  [...logsOf(container).querySelectorAll("fieldset")]
    .filter((fieldset) => ["Logs view", "Over"].includes(fieldset.querySelector("legend")?.textContent ?? ""))
    .flatMap((fieldset) => [...fieldset.querySelectorAll("button[aria-pressed=true]")])
    .map((each) => each.textContent?.trim())

/** The page as if opened at `path`, as happy-dom starts at about:blank, where the history cannot be written. */
const openedAt = (path: string) => {
  ;(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(`http://estate${path}`)
}

/** The Logs panel's button named `name`. */
const inLogs = (container: HTMLElement, name: string) => {
  const found = [...logsOf(container).querySelectorAll("button")].find((each) => each.textContent?.trim() === name)
  if (found === undefined) throw new Error(`no ${name} in the Logs panel`)
  return found
}

describe("a service page's logs", () => {
  test("open on what the address asks for", async () => {
    const page = mount(() => <ServicePage name="storefront" logs={{ view: "errors", range: "24h" }} />)
    await page.settle()
    expect(pressed(page.container)).toEqual(["Errors", "24h"])
    expect(page.calls).toContainEqual(["errors", "storefront", { range: "24h" }])
    page.dispose()
  })

  test("write what is chosen in them to the address, keeping its environment, without adding to the history", () => {
    openedAt("/services/storefront?env=staging")
    const before = window.history.length
    const page = mount(() => <ServicePage name="storefront" />)
    const address = () => `${window.location.pathname}${window.location.search}`
    page.click(inLogs(page.container, "Errors"))
    const errors = address()
    page.click(inLogs(page.container, "6h"))
    const sixHours = address()
    page.click(inLogs(page.container, "Live"))
    expect([errors, sixHours, address()]).toEqual([
      "/services/storefront?logs=errors&env=staging",
      "/services/storefront?logs=errors&range=6h&env=staging",
      "/services/storefront?env=staging",
    ])
    expect(window.history.length).toBe(before)
    page.dispose()
  })
})

/** Actions as recorded, with the errors answered as given, and every ask for them counted. */
const answering = (answer: ErrorGroups | "none" | undefined) => {
  const recorded = recording()
  const asked: Array<readonly [string, unknown]> = []
  const actions: Actions = {
    ...recorded.actions,
    errors: (service, window) => {
      asked.push([service, window])
      return Promise.resolve(answer)
    },
  }
  return { actions, asked, calls: recorded.calls }
}

const headOf = (container: HTMLElement) => container.querySelector(".errors-day")?.textContent?.trim()

const many = (count: number, groupsOf: number, from = "Loki"): ErrorGroups => ({
  from,
  groups: Array.from({ length: groupsOf }, (_, at) => ({
    ...(groups.groups[0] as ErrorGroups["groups"][number]),
    shape: `shape ${at}`,
    count: at === 0 ? count - (groupsOf - 1) : 1,
  })),
})

describe("a service's errors over the last day", () => {
  test("are counted under its health, with their groups, and say when there were more", async () => {
    const shown = async (answer: ErrorGroups | "none" | undefined) => {
      const { actions } = answering(answer)
      const page = mount(() => <ServicePage name="storefront" />, { actions })
      await page.settle()
      const text = headOf(page.container)
      page.dispose()
      return text
    }
    expect(await shown(many(37, 4))).toBe("37 errors · 4 groups in 24h")
    expect(await shown(many(1, 1))).toBe("1 error · 1 group in 24h")
    expect(await shown({ ...many(2000, 3), capped: true })).toBe("2,000+ errors · 3 groups in 24h")
    expect(await shown({ from: "Loki", groups: [] })).toBe("No errors in 24h")
    expect(await shown(many(12, 3, "the cluster"))).toBe("12 errors · 3 groups since the pods started")
    expect(await shown(undefined)).toBe("Errors in 24h: the logs did not answer")
    expect(await shown("none")).toBeUndefined()
  })

  test("go to the Logs panel's errors over 24h, adding to the history and telling the page it moved", async () => {
    openedAt("/services/storefront?env=staging")
    const before = window.history.length
    const moved: Array<string> = []
    const heard = () => moved.push(window.location.search)
    window.addEventListener("popstate", heard)
    const page = mount(() => <ServicePage name="storefront" />)
    await page.settle()
    const link = page.container.querySelector<HTMLElement>(".errors-day")
    if (link === null) throw new Error("no errors over the day")
    page.click(link)
    window.removeEventListener("popstate", heard)
    expect(moved).toEqual(["?logs=errors&range=24h&env=staging"])
    expect(window.history.length).toBe(before + 1)
    page.dispose()
  })

  test("are opened by the address when it changes, as Back or a link does", async () => {
    const [logs, setLogs] = createSignal<LogsShown | undefined>(undefined)
    const page = mount(() => <ServicePage name="storefront" logs={logs()} />)
    expect(pressed(page.container)).toEqual(["Live"])
    setLogs({ view: "errors", range: "24h" })
    await page.settle()
    expect(pressed(page.container)).toEqual(["Errors", "24h"])
    setLogs(undefined)
    expect(pressed(page.container)).toEqual(["Live"])
    page.dispose()
  })

  test("are read again every 5 minutes, but not while the tab is hidden", () => {
    jest.useFakeTimers()
    try {
      const { actions, asked } = answering(groups)
      const page = mount(() => <ServicePage name="storefront" />, { actions })
      const reads = () => asked.filter(([, window]) => JSON.stringify(window) === '{"range":"24h"}').length
      expect(reads()).toBe(1)
      jest.advanceTimersByTime(5 * 60_000)
      expect(reads()).toBe(2)
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
      jest.advanceTimersByTime(15 * 60_000)
      expect(reads()).toBe(2)
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
      document.dispatchEvent(new Event("visibilitychange"))
      expect(reads()).toBe(3)
      page.dispose()
    } finally {
      jest.useRealTimers()
    }
  })
})
