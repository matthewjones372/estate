/** @jsxImportSource solid-js */
/** Auto, Cards or Rows for what is firing, Rows unless chosen (spec 0065), kept in this browser. */
import { createSignal, For } from "solid-js"
import type { Alert } from "../../shared/events"
import { kept } from "../kept"

const preference = kept("estate.alerts.layout")
type Layout = "auto" | "cards" | "rows"
const layouts: ReadonlyArray<{ readonly value: Layout; readonly label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "cards", label: "Cards" },
  { value: "rows", label: "Rows" },
]
const initial = (): Layout => layouts.find((each) => each.value === preference.read())?.value ?? "rows"

/** More firing than this, and *Auto* shows rows: two cards fill a laptop's width, four are about a screen. */
const fewest = 3

/** The chosen layout, read from this browser once, and whether it shows these firing as rows. */
export const alertsLayout = () => {
  const [layout, setLayout] = createSignal<Layout>(initial())
  return {
    layout,
    choose: (next: Layout) => {
      setLayout(next)
      preference.write(next)
    },
    rows: (alerts: ReadonlyArray<Alert>) => layout() === "rows" || (layout() === "auto" && alerts.length > fewest),
  }
}

export const LayoutChoice = (props: { readonly layout: Layout; readonly choose: (next: Layout) => void }) => (
  <fieldset class="choices bare alerts-layout">
    <legend class="visually-hidden">Alerts layout</legend>
    <For each={layouts}>
      {(each) => (
        <button
          type="button"
          class="choice"
          aria-pressed={props.layout === each.value}
          onClick={() => props.choose(each.value)}
        >
          {each.label}
        </button>
      )}
    </For>
  </fieldset>
)
