/** @jsxImportSource solid-js */
/** A service's logs as an incident's evidence kept them: its errors grouped by message, and its lines, with what was left out. */
import { For, Show } from "solid-js"
import type { KeptLogs } from "../../shared/evidence"
import { instant } from "../format"

export const EvidenceLogs = (props: { readonly logs: KeptLogs }) => (
  <div class="kept-logs stack">
    <h3 class="section-title">
      {props.logs.service} logs, {props.logs.environment}
      {props.logs.from === "included" ? "" : `, from ${props.logs.from}`}: {props.logs.lines.length} lines kept
      {props.logs.leftOut === 0 ? "" : `, ${props.logs.leftOut} left out past incidents.evidence.lines`}
    </h3>
    <Show when={props.logs.errors.length > 0} fallback={<p class="muted">No errors among them.</p>}>
      <section class="table-scroll" aria-label={`Errors among ${props.logs.service}'s kept lines`} tabindex="0">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">Times</th>
              <th scope="col">Error</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.logs.errors}>
              {(group) => (
                <tr>
                  <td class="mono">{group.count}</td>
                  <td class="mono">{group.shape}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>
    </Show>
    <details>
      <summary>Lines</summary>
      <ol class="log-lines">
        <For each={props.logs.lines}>
          {(line) => (
            <li class="kept-line mono">
              {instant(line.at)} {line.pod ?? ""} {line.text}
            </li>
          )}
        </For>
      </ol>
    </details>
  </div>
)
