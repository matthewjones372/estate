/** @jsxImportSource solid-js */
/**
 * What people included in an incident (spec 0051), newest first: what it is, who included it, when and why, drawn as
 * where it was found. Whoever included it, or an operator, removes it, which hides it here and is kept as an event.
 */
import { createSignal, For, Show } from "solid-js"
import { type EvidenceSet, includedIn } from "../../shared/evidence"
import type { IncidentRecord } from "../../shared/incidents"
import { useEstate } from "../context"
import { day } from "../format"
import { EvidenceLogs } from "./EvidenceLogs"
import { EvidenceTraces } from "./EvidenceTraces"
import { KeptChartFigure, shadeOf } from "./KeptChart"

/** What a set holds, in a few words. */
const whatOf = (set: EvidenceSet) => {
  const [chart, logs, trace] = [set.charts[0], set.logs?.[0], set.traces?.[0]]
  if (chart !== undefined) return `${chart.service} · ${chart.panel}`
  if (trace !== undefined) return `trace ${trace.id}${trace.journey === undefined ? "" : ` · ${trace.journey}`}`
  if (logs === undefined) return "logs left out for you here"
  return logs.errors.length > 0
    ? `${logs.service} · an error`
    : `${logs.service} · ${logs.lines.length} log ${logs.lines.length === 1 ? "line" : "lines"}`
}

export const IncludedEvidence = (props: { readonly record: IncidentRecord; readonly changed: () => void }) => {
  const { actions, me } = useEstate()
  const [mark, setMark] = createSignal<number | undefined>(undefined)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const shown = () => includedIn(props.record.evidence, props.record.events).shown
  const marks = () => props.record.events.map((event) => Date.parse(event.at))
  const mayRemove = (set: EvidenceSet) =>
    me.kiosk !== true && me.readOnly !== true && (set.keptBy === me.name || me.role === "operator")
  const remove = (set: EvidenceSet) => {
    setRefused(undefined)
    void actions.removeIncluded(props.record.incident.id, set.id).then((result) => {
      if (result === true) props.changed()
      else setRefused(result)
    })
  }
  return (
    <Show when={shown().length > 0}>
      <div class="stack incident-included">
        <h3 class="section-title">Included</h3>
        <ol class="stack">
          <For each={shown()}>
            {(set) => (
              <li class="stack included-item">
                <div class="spread">
                  <span>
                    <strong>{whatOf(set)}</strong>{" "}
                    <span class="muted">
                      {set.keptBy}, {day(set.keptAt)}
                    </span>
                    <Show when={set.why}>{(why) => <span class="included-why"> “{why()}”</span>}</Show>
                  </span>
                  <Show when={mayRemove(set)}>
                    <button type="button" class="plain-button" onClick={() => remove(set)}>
                      Remove
                    </button>
                  </Show>
                </div>
                <For each={set.charts}>
                  {(chart) => (
                    <KeptChartFigure
                      chart={chart}
                      set={set}
                      shade={shadeOf(props.record.incident, set)}
                      marks={marks()}
                      mark={mark()}
                      onMark={setMark}
                    />
                  )}
                </For>
                <For each={set.logs ?? []}>{(logs) => <EvidenceLogs logs={logs} />}</For>
                <EvidenceTraces traces={set.traces ?? []} />
              </li>
            )}
          </For>
        </ol>
        <Show when={refused()}>
          {(why) => (
            <p class="alert-detail" role="alert">
              {why()}
            </p>
          )}
        </Show>
        <h3 class="section-title">Kept by Estate</h3>
      </div>
    </Show>
  )
}
