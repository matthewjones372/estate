/** @jsxImportSource solid-js */
/** A service's pods (or tasks) as read from the cluster. */
import { For, Show } from "solid-js"
import type { ServiceState } from "../../shared/events"
import { useEstate } from "../context"
import { since } from "../format"

export const ServicePods = (props: { readonly pods: ServiceState["pods"] }) => {
  const { now } = useEstate()
  return (
    <section aria-labelledby="pods" class="stack">
      <h2 id="pods" class="section-title">
        Pods
      </h2>
      <Show when={props.pods.length === 0}>
        <p class="muted" style={{ margin: 0 }}>
          No pods read for it here.
        </p>
      </Show>
      <div class="pods">
        <For each={props.pods}>
          {(pod) => (
            <div class="pod">
              <span class="spread">
                <span class="mono">{pod.name}</span>
                <span class="health">
                  <span class={`dot ${pod.ready ? "healthy" : "attention"}`} />
                  {pod.ready ? "Ready" : pod.phase}
                </span>
              </span>
              <span class="muted" style={{ "font-size": "12px" }}>
                {pod.node ?? ""}
                {pod.startedAt === undefined ? "" : ` · up ${since(pod.startedAt, now())}`}
              </span>
              <span class="muted" style={{ "font-size": "12px" }}>
                {pod.restarts === 0 ? "no restarts" : `${pod.restarts} restarts`}
              </span>
            </div>
          )}
        </For>
      </div>
    </section>
  )
}
