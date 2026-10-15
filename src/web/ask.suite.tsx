/** @jsxImportSource solid-js */
/** Ask AI on an alert's card: run by `ask.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { longestNote } from "../shared/note"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { AlertCard } from "./parts/AlertCard"
import { noteOf } from "./parts/AskAi"
import { recording } from "./recording"

const alert = events.alerts.alerts[0] as Alert
const asking = { ...operator, ai: true }
const askAi = /^Ask AI/
const card =
  (shown: Alert = alert) =>
  () => <AlertCard alert={shown} catalog={events.catalog} canSilence={false} />

describe("Ask AI on an alert's card", () => {
  test("is not offered when ai is off", () => {
    const page = mount(card())
    expect(page.container.textContent).not.toContain("Ask AI")
  })

  test("asks from the card, shows a bar while it reads, and answers on the card", async () => {
    const page = mount(card(), { me: asking })
    page.click(page.button(askAi))
    expect(page.container.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe(
      "Asking AI about OrdersSlow",
    )
    expect(page.container.textContent).toContain("Reading Estate… 0 s")
    const busy = page.button(/^Asking…/)
    expect([busy.disabled, busy.getAttribute("aria-busy")]).toEqual([true, "true"])
    page.click(busy)
    await page.settle()
    expect(page.calls.filter(([action]) => action === "askAlert")).toHaveLength(1)
    const shown = page.container.textContent ?? ""
    expect(page.calls).toContainEqual(["askAlert", "a1"])
    expect(page.container.querySelector('[role="progressbar"]')).toBeNull()
    expect(shown).toContain("Likely cause A recent deploy raised latency.")
    expect(shown).toContain(
      "fake-model · 15,000 in (11,800 cached) · 1,100 out · about $0.03 · read: Changed · Runbook · called: service orders",
    )
    expect(page.container.querySelector('a[href="https://ci.example/1"]')?.textContent).toContain("deployed 26 min")
    // The server answers an alert once a minute, so the button rests for it rather than earn a refusal.
    expect(page.button(/^Ask again/).disabled).toBe(true)
  })

  test("keeps the answer as a note once", async () => {
    const page = mount(card(), { me: asking })
    page.click(page.button(askAi))
    await page.settle()
    page.click(page.button("Keep as note"))
    await page.settle()
    expect(page.calls).toContainEqual([
      "addNote",
      "a1",
      "Ask AI (fake-model): A recent deploy raised latency.\n· storefront v2 deployed 26 min before it fired\nNext: Check the runbook\nNext: Compare p99 before and after the deploy\nConfidence: medium",
      "ask-ai",
    ])
    expect(page.container.querySelector('[role="status"]')?.textContent).toContain("Kept as a note, under Notes above")
    expect(page.calls.filter(([action]) => action === "addNote")).toHaveLength(1)
  })

  test("says so when the note could not be kept, and shows it is keeping until then", async () => {
    let settle: (saved: boolean) => void = () => undefined
    const actions = {
      ...recording().actions,
      addNote: () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        }),
    }
    const page = mount(card(), { me: asking, actions })
    page.click(page.button(askAi))
    await page.settle()
    page.click(page.button("Keep as note"))
    expect(page.button(/^Keeping…/).disabled).toBe(true)
    settle(false)
    await page.settle()
    expect(page.container.querySelector('[role="alert"]')?.textContent).toBe("The note could not be kept. Try again.")
    expect(page.button("Keep as note").disabled).toBe(false)
  })

  test("keeps a long answer as a note that fits, dropping evidence from the end and saying how much", () => {
    const answer = {
      likelyCause: "The registry is slow.",
      evidence: Array.from({ length: 30 }, (_, at) => ({ text: `evidence ${at} ${"x".repeat(80)}` })),
      nextSteps: ["Check the registry"],
      confidence: "low" as const,
      model: "m",
      read: [],
      called: [],
      usage: { input: 0, cached: 0, output: 0 },
      readLogs: false,
    }
    const note = noteOf(answer)
    expect(note.length).toBeLessThanOrEqual(longestNote)
    expect(note).toContain("evidence 0 ")
    expect(note).toMatch(/· and \d+ more on the card/)
    expect(note).toContain("Next: Check the registry")
    expect(note.endsWith("Confidence: low")).toBe(true)
  })

  test("says why there is no answer, as an alert", async () => {
    const page = mount(card({ ...alert, id: "a2" }), { me: asking })
    page.click(page.button(askAi))
    await page.settle()
    expect(page.container.querySelector('[role="alert"]')?.textContent).toBe(
      "this alert was asked about less than a minute ago",
    )
  })

  test("an answer asked on one page is on the same alert's card on another", async () => {
    const { actions } = recording()
    const overview = mount(card(), { me: asking, actions })
    overview.click(overview.button(askAi))
    await overview.settle()
    overview.dispose()
    const own = mount(() => <AlertPage id="a1" />, { me: asking, actions })
    expect(own.container.textContent).toContain("Likely cause A recent deploy raised latency.")
    expect(
      [...own.container.querySelectorAll("button")].filter((each) => /^Ask (AI|again)/.test(each.textContent ?? "")),
    ).toHaveLength(1)
  })

  test("stops its ask when the card is left, and can ask again", async () => {
    const signals: AbortSignal[] = []
    const actions = {
      ...recording().actions,
      askAlert: (_alert: string, signal: AbortSignal) => {
        signals.push(signal)
        return new Promise<never>(() => undefined)
      },
    }
    const page = mount(card(), { me: asking, actions })
    page.click(page.button(askAi))
    page.dispose()
    expect(signals[0]?.aborted).toBe(true)
    const again = mount(card(), { me: asking, actions })
    expect(again.button(askAi).disabled).toBe(false)
    expect(again.button(askAi).getAttribute("aria-busy")).toBe("false")
  })

  test("warns before keeping an answer that read logs as a note for everyone, only where logs are for operators", async () => {
    const warning =
      "This answer read logs only operators can read. A note is seen by everyone, viewers and the Slack thread too."
    const shown = async (readLogs: boolean, logsForOperators: boolean) => {
      const { actions, calls } = recording()
      const answering = {
        ...actions,
        askAlert: (id: string, signal: AbortSignal) =>
          actions.askAlert(id, signal).then((found) => (typeof found === "string" ? found : { ...found, readLogs })),
      }
      const page = mount(card(), {
        me: { ...asking, ...(logsForOperators ? { logsForOperators } : {}) },
        actions: answering,
      })
      page.click(page.button(askAi))
      await page.settle()
      const keeps = [...page.container.querySelectorAll(".ask-keep button")].map((each) => each.textContent)
      return { page, calls, keeps, warned: page.container.textContent?.includes(warning) ?? false }
    }
    const warned = await shown(true, true)
    expect([warned.keeps, warned.warned]).toEqual([["Keep as note for everyone"], true])
    warned.page.click(warned.page.button("Keep as note for everyone"))
    await warned.page.settle()
    expect(warned.calls.filter(([action]) => action === "addNote")).toHaveLength(1)
    expect(warned.page.container.textContent).not.toContain(warning)
    for (const [readLogs, logsForOperators] of [
      [true, false],
      [false, true],
    ] as const) {
      const plain = await shown(readLogs, logsForOperators)
      expect([plain.keeps, plain.warned]).toEqual([["Keep as note"], false])
    }
  })
})
