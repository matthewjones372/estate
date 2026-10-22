/**
 * How the overview is drawn, chosen in its one View menu (spec 0068) and kept in this browser: the map as Auto, Areas
 * or Lines (spec 0065), and services as list lanes or a grid.
 */
import { type Accessor, createSignal } from "solid-js"
import { kept } from "./kept"

export interface Choice<Value extends string> {
  readonly chosen: Accessor<Value>
  readonly choose: (next: Value) => void
  readonly options: ReadonlyArray<{ readonly value: Value; readonly label: string }>
}

const choiceOf = <Value extends string>(
  key: string,
  options: ReadonlyArray<{ readonly value: Value; readonly label: string }>,
  fallback: Value,
): Choice<Value> => {
  const preference = kept(key)
  const [chosen, setChosen] = createSignal<Value>(
    options.find((each) => each.value === preference.read())?.value ?? fallback,
  )
  return {
    chosen,
    choose: (next) => {
      setChosen(() => next)
      preference.write(next)
    },
    options,
  }
}

export type MapLayout = "auto" | "areas" | "lines"
export type ServicesLayout = "list" | "grid"

export const mapChoice = () =>
  choiceOf<MapLayout>(
    "estate.map.layout",
    [
      { value: "auto", label: "Auto" },
      { value: "areas", label: "Areas" },
      { value: "lines", label: "Lines" },
    ],
    "auto",
  )

export const servicesChoice = () =>
  choiceOf<ServicesLayout>(
    "estate.services.layout",
    [
      { value: "list", label: "List" },
      { value: "grid", label: "Grid" },
    ],
    "list",
  )
