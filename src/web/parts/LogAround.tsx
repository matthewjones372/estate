/** @jsxImportSource solid-js */
/** How many held lines before and after each match the Live view shows with it (spec 0067), kept in this browser. */
import { createSignal, For } from "solid-js"
import { kept } from "../kept"
import type { Reach } from "../log-around"

const choices = [0, 2, 5, 10] as const
const chosenOf = (value: string | null) => choices.find((each) => String(each) === value) ?? 0

const side = (name: "before" | "after", label: string) => {
  const preference = kept(`estate.logs.${name}`)
  const [count, setCount] = createSignal<number>(chosenOf(preference.read()))
  const choose = (value: string) => {
    setCount(chosenOf(value))
    preference.write(String(chosenOf(value)))
  }
  const Choice = () => (
    <label class={`select-label log-reach-${name}`}>
      {label}
      <select class="select" value={String(count())} onChange={(event) => choose(event.currentTarget.value)}>
        <For each={choices}>
          {(each) => <option value={String(each)}>{each === 0 ? "None" : `${each} lines`}</option>}
        </For>
      </select>
    </label>
  )
  return { count, Choice }
}

/** The numbers chosen, read from this browser once, the selects that choose them, and how the foot says them. */
export const aroundChoice = () => {
  const before = side("before", "Before")
  const after = side("after", "After")
  const reach = (): Reach => ({ before: before.count(), after: after.count() })
  const said = () => {
    const { before, after } = reach()
    if (before === after) return `${before} lines around each`
    if (after === 0) return `${before} lines before each`
    if (before === 0) return `${after} lines after each`
    return `${before} lines before and ${after} after each`
  }
  const Choice = () => (
    <>
      <before.Choice />
      <after.Choice />
    </>
  )
  return { reach, reaching: () => before.count() + after.count() > 0, said, Choice }
}
