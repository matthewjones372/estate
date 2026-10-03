/** @jsxImportSource solid-js */
/** A part of the page drawn with the fixture's events: as text to read, or mounted to act on. */
import type { JSX } from "solid-js"
import { delegateEvents, render as draw } from "solid-js/web"
import type { Events, Me } from "../shared/events"
import { type Actions, EstateContext } from "./context"
import { events, heard, now, operator, recording } from "./fixture"
import type { Live } from "./live"
import type { Page } from "./route"

interface Options {
  readonly page?: Page
  readonly me?: Me
  readonly sent?: Partial<Events>
  readonly actions?: Actions
  readonly live?: Live
}

const within = (node: () => JSX.Element, options: Options, actions: Actions) => () => (
  <EstateContext.Provider
    value={{
      live: options.live ?? heard(options.sent ?? events),
      me: options.me ?? operator,
      page: () => options.page ?? { page: "overview" },
      actions,
      now: () => now,
    }}
  >
    {node()}
  </EstateContext.Provider>
)

/** The part's markup once drawn. */
export const render = (node: () => JSX.Element, options: Options = {}): string => {
  const container = document.createElement("div")
  const dispose = draw(within(node, options, options.actions ?? recording().actions), container)
  const html = container.innerHTML
  dispose()
  return html
}

/** The part left on the page, with what its actions were asked, and ways to click and type into it. */
// Solid listens for these on the document as its modules load; a test file's fresh document needs them again.
const delegated = ["click", "input", "keydown", "pointermove", "pointerdown", "pointerup", "submit", "change"]

export const mount = (node: () => JSX.Element, options: Options = {}) => {
  delegateEvents(delegated)
  const recorded = recording()
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = draw(within(node, options, options.actions ?? recorded.actions), container)
  const button = (name: string | RegExp) => {
    const found = [...container.querySelectorAll("button")].find((each) =>
      typeof name === "string" ? each.textContent?.trim() === name : name.test(each.textContent ?? ""),
    )
    if (found === undefined) throw new Error(`no button ${name} in ${container.textContent}`)
    return found
  }
  const click = (element: HTMLElement, init: MouseEventInit = {}) =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }))
  const type = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    element.value = value
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }))
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { container, calls: recorded.calls, button, click, type, settle, dispose }
}
