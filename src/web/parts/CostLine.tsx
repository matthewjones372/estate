/** @jsxImportSource solid-js */
/** An entry's cost under its name, with where the figures come from on hover. */
import { Show } from "solid-js"
import { type Cost, costLine } from "../../shared/costs"

export const CostLine = (props: { readonly cost: Cost | undefined }) => (
  <Show when={costLine(props.cost)}>
    {(line) => (
      <span class="muted cost-line" title={`From ${props.cost?.from ?? ""}`}>
        {line()}
      </span>
    )}
  </Show>
)
