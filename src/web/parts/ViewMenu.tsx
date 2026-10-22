/** @jsxImportSource solid-js */
/** The overview's one place to choose how it is drawn (spec 0068): the map's layout and the services'. */
import { For } from "solid-js"
import type { Choice, MapLayout, ServicesLayout } from "../view-choices"

const Options = <Value extends string>(props: { readonly legend: string; readonly choice: Choice<Value> }) => (
  <fieldset class="choices bare view-choice">
    <legend class="muted small">{props.legend}</legend>
    <For each={props.choice.options}>
      {(each) => (
        <button
          type="button"
          class="choice"
          aria-pressed={props.choice.chosen() === each.value}
          onClick={() => props.choice.choose(each.value)}
        >
          {each.label}
        </button>
      )}
    </For>
  </fieldset>
)

export const ViewMenu = (props: { readonly map: Choice<MapLayout>; readonly services: Choice<ServicesLayout> }) => (
  <details class="view-menu">
    <summary class="plain-button">View</summary>
    <div class="view-menu-body">
      <Options legend="Draw the estate as" choice={props.map} />
      <Options legend="Services as" choice={props.services} />
    </div>
  </details>
)
