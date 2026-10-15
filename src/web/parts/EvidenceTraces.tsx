/** @jsxImportSource solid-js */
/** The traces an incident's evidence kept, each opening on the trace page, which reads it from what was kept. */
import { For, Show } from "solid-js"
import type { KeptTrace } from "../../shared/evidence"
import { tookOf } from "../../shared/traces"
import { took } from "../format"
import { pathOf } from "../route"
import { A } from "./A"

const why = (trace: KeptTrace) =>
  trace.why === "named" ? "named in a kept line" : `${trace.journey ?? ""}, ${trace.why}`

export const EvidenceTraces = (props: { readonly traces: ReadonlyArray<KeptTrace> }) => (
  <Show when={props.traces.length > 0}>
    <div class="kept-traces stack">
      <h3 class="section-title">Traces</h3>
      <ul>
        <For each={props.traces}>
          {(trace) => (
            <li class="mono">
              <A
                to={pathOf({
                  page: "trace",
                  id: trace.id,
                  ...(trace.journey === undefined ? {} : { journey: trace.journey }),
                })}
              >
                {trace.id}
              </A>{" "}
              {why(trace)}, {took(tookOf(trace))}
            </li>
          )}
        </For>
      </ul>
    </div>
  </Show>
)
