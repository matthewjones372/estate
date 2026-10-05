/** @jsxImportSource solid-js */
/** Builds on main for a service, and a short "what changed" framing for the investigation path. */
import { For, Show } from "solid-js"
import type { DeploysEvent } from "../../shared/events"
import { useEstate } from "../context"
import { since } from "../format"
import { Out } from "./A"

type Build = DeploysEvent["services"][number]["builds"][number]

export const ServiceBuilds = (props: { readonly builds: ReadonlyArray<Build> }) => {
  const { now } = useEstate()
  return (
    <section aria-labelledby="builds" class="panel section-box">
      <h2 id="builds" class="section-title">
        What changed
      </h2>
      <Show when={props.builds.length === 0}>
        <p class="muted" style={{ margin: 0 }}>
          No builds read.
        </p>
      </Show>
      <ol class="builds">
        <For each={props.builds}>
          {(build) => (
            <li>
              <span
                class={`dot ${build.status === "success" ? "healthy" : build.status === "failure" ? "critical" : "unknown"}`}
                style={{ "margin-top": "6px" }}
              />
              <div style={{ "min-width": 0 }}>
                <Out href={build.url}>{build.title}</Out>
                <div class="muted mono" style={{ "font-size": "12px" }}>
                  {build.sha.slice(0, 7)} · {build.status}
                  {build.job === undefined ? "" : ` at ${build.job}`} · {since(build.at, now())} ago
                </div>
              </div>
            </li>
          )}
        </For>
      </ol>
    </section>
  )
}
