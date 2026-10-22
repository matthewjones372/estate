/** @jsxImportSource solid-js */
/** How many held lines either side of each match the Live view shows with it (spec 0067), kept in this browser. */
import { createSignal, For } from "solid-js"
import { kept } from "../kept"

const choices = [0, 2, 5, 10] as const
const preference = kept("estate.logs.around")
const chosenOf = (value: string | null) => choices.find((each) => String(each) === value) ?? 0

/** The number chosen, read from this browser once, and the select that chooses it. */
export const aroundChoice = () => {
  const [each, setEach] = createSignal<number>(chosenOf(preference.read()))
  const choose = (value: string) => {
    setEach(chosenOf(value))
    preference.write(String(chosenOf(value)))
  }
  const Choice = () => (
    <label class="select-label log-around">
      Around
      <select class="select" value={String(each())} onChange={(event) => choose(event.currentTarget.value)}>
        <For each={choices}>
          {(count) => <option value={String(count)}>{count === 0 ? "None" : `${count} lines`}</option>}
        </For>
      </select>
    </label>
  )
  return { each, Choice }
}
