/** @jsxImportSource solid-js */
/**
 * *What changed*: each of an incident's services' versions at its start, what was deployed or rolled back during it,
 * and at its close, or now while it is open, with a link to compare the two where the catalog gives one.
 */
import { For, Show } from "solid-js"
import type { ServiceVersions } from "../../shared/incident-versions"
import { clock } from "../format"
import { Out } from "./A"

const during = (row: ServiceVersions) =>
  row.changes.length === 0
    ? "-"
    : row.changes.map((each) => `${each.to} at ${clock(each.at)}${each.rolledBack ? ", rolled back" : ""}`).join("; ")

export const IncidentVersions = (props: {
  readonly versions: ReadonlyArray<ServiceVersions>
  readonly closed: boolean
}) => (
  <Show when={props.versions.length > 0}>
    <section aria-labelledby="incident-versions" class="panel section-box stack incident-versions">
      <h2 id="incident-versions" class="section-title">
        What changed
      </h2>
      <section class="table-scroll" aria-labelledby="incident-versions" tabindex="0">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Where</th>
              <th scope="col">At start</th>
              <th scope="col">During</th>
              <th scope="col">{props.closed ? "At close" : "Now"}</th>
              <th scope="col">
                <span class="visually-hidden">Compare</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={props.versions}>
              {(row) => (
                <tr>
                  <td>{row.service}</td>
                  <Show
                    when={row.environment}
                    fallback={
                      <td colSpan={5} class="muted">
                        No version is known for it.
                      </td>
                    }
                  >
                    {(environment) => (
                      <>
                        <td>{environment()}</td>
                        <td>{row.start ?? "not known here"}</td>
                        <td>{during(row)}</td>
                        <td>{row.close ?? "-"}</td>
                        <td>
                          <Show when={row.compare}>{(link) => <Out href={link()}>compare ↗</Out>}</Show>
                        </td>
                      </>
                    )}
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>
    </section>
  </Show>
)
