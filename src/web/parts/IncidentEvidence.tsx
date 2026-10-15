/** @jsxImportSource solid-js */
/**
 * *Evidence*: the charts, logs and traces last kept for an incident, drawn from its record and not its sources, so they read
 * the same once the sources are gone; its span shaded and its events marked. An operator keeps them again while open.
 */
import { createSignal, For, Show } from "solid-js"
import { keptByEstate } from "../../shared/evidence"
import type { IncidentRecord } from "../../shared/incidents"
import { useEstate } from "../context"
import { day } from "../format"
import { EvidenceLogs } from "./EvidenceLogs"
import { EvidenceTraces } from "./EvidenceTraces"
import { canKeepIncidents } from "./IncidentLink"
import { Plot } from "./Plot"

export const IncidentEvidence = (props: { readonly record: IncidentRecord; readonly changed: () => void }) => {
  const { actions, me } = useEstate()
  const [mark, setMark] = createSignal<number | undefined>(undefined)
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const incident = () => props.record.incident
  const latest = () => keptByEstate(props.record.evidence).at(-1)
  // From its first firing, or its opening if earlier, to its close or the last point kept.
  const shade = () => {
    const set = latest()
    if (set === undefined) return undefined
    const from = Math.min(
      Date.parse(incident().openedAt),
      ...incident().firings.map((each) => Date.parse(each.startsAt)),
    )
    return {
      from,
      to: incident().closedAt === undefined ? set.window.end * 1000 : Date.parse(incident().closedAt ?? ""),
    }
  }
  const marks = () => props.record.events.map((event) => Date.parse(event.at))
  const keep = () => {
    if (busy()) return
    setBusy(true)
    setRefused(undefined)
    void actions.keepIncidentEvidence(incident().id).then((result) => {
      setBusy(false)
      if (result === true) props.changed()
      else setRefused(result)
    })
  }
  return (
    <section aria-labelledby="incident-evidence" class="panel section-box stack incident-evidence" aria-busy={busy()}>
      <div class="section-head">
        <h2 id="incident-evidence" class="section-title">
          Evidence
        </h2>
        <Show when={canKeepIncidents(me) && incident().closedAt === undefined}>
          <button type="button" class="amber-button ghost" disabled={busy()} onClick={keep}>
            Keep evidence now
          </button>
        </Show>
      </div>
      <Show when={me.logsForOperators === true && me.role !== "operator"}>
        <p class="muted withheld">
          Logs and the traces drawn from them are for operators here, so they are left out of what you read and export.
        </p>
      </Show>
      <Show
        when={latest()}
        fallback={
          <p class="muted">
            Nothing is kept yet: it is kept when the incident closes, or when an operator keeps it now.
          </p>
        }
      >
        {(set) => (
          <>
            <p class="muted">
              Kept by {set().keptBy}, {day(set().keptAt)}. {keptByEstate(props.record.evidence).length}{" "}
              {keptByEstate(props.record.evidence).length === 1 ? "set" : "sets"} kept.
            </p>
            <div class="charts">
              <For each={set().charts}>
                {(chart) => (
                  <figure class="chart">
                    <figcaption class="muted">
                      {chart.service} {chart.panel}
                      {chart.unit === undefined ? "" : ` (${chart.unit})`}, {chart.environment}
                    </figcaption>
                    <Plot
                      label={`${chart.service} ${chart.panel} in ${chart.environment}, as kept`}
                      points={chart.points}
                      end={set().window.end * 1000}
                      span={(set().window.end - set().window.start) * 1000}
                      width={300}
                      height={110}
                      pad={4}
                      ink="#8FB0FF"
                      baseline
                      mark={mark()}
                      onMark={setMark}
                      shade={shade()}
                      marks={marks()}
                    />
                  </figure>
                )}
              </For>
            </div>
            <For each={set().logs ?? []}>{(logs) => <EvidenceLogs logs={logs} />}</For>
            <EvidenceTraces traces={set().traces ?? []} />
          </>
        )}
      </Show>
      <Show when={refused()}>
        {(why) => (
          <p class="alert-detail" role="alert">
            {why()}
          </p>
        )}
      </Show>
    </section>
  )
}
