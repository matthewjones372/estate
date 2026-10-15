/** @jsxImportSource solid-js */
/**
 * *Summary* (spec 0051): Summarise asks the model Ask AI asks for an account of the incident, from everything on its
 * page; *Keep as note* keeps it on the incident, where the newest kept heads its export. Shown where `ai` is set.
 */
import { createSignal, For, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import { longestNote } from "../../shared/note"
import type { SummaryAnswer } from "../../shared/summary"
import { useEstate } from "../context"
import { clock } from "../format"
import { spent } from "./AskAi"

/** The summary as a note: each part on its own line, cut short where it passes a note's longest. */
const noteOf = (answer: SummaryAnswer) => {
  const whole = [
    `Summary (${answer.model}): ${answer.what}`,
    `Impact: ${answer.impact}`,
    `Cause: ${answer.cause}`,
    ...answer.turns.map((turn) => `· ${clock(turn.at)} ${turn.text}`),
    ...answer.followUps.map((each) => `Next: ${each}`),
    `Confidence: ${answer.confidence}`,
  ].join("\n")
  return whole.length <= longestNote ? whole : `${whole.slice(0, longestNote - 1)}…`
}

export const IncidentSummary = (props: { readonly incident: Incident; readonly changed: () => void }) => {
  const { me, actions } = useEstate()
  const [busy, setBusy] = createSignal(false)
  const [answer, setAnswer] = createSignal<SummaryAnswer | undefined>(undefined)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const [kept, setKept] = createSignal(false)
  const mayWrite = () => me.kiosk !== true && me.readOnly !== true
  const summarise = () => {
    if (busy()) return
    setBusy(true)
    setRefused(undefined)
    void actions.summarise(props.incident.id).then((result) => {
      setBusy(false)
      if (typeof result === "string") setRefused(result)
      else {
        setAnswer(result)
        setKept(false)
      }
    })
  }
  const keep = (written: SummaryAnswer) =>
    void actions.addIncidentNote(props.incident.id, noteOf(written), "summary").then((result) => {
      if (typeof result === "string") setRefused(result)
      else {
        setKept(true)
        props.changed()
      }
    })
  return (
    <Show when={me.ai === true}>
      <section aria-labelledby="incident-summary" class="panel section-box stack incident-summary" aria-busy={busy()}>
        <div class="section-head">
          <h2 id="incident-summary" class="section-title">
            Summary
          </h2>
          <Show when={mayWrite()}>
            <button type="button" class="amber-button ghost" disabled={busy()} onClick={summarise}>
              <Show when={busy()} fallback={answer() === undefined ? "Summarise" : "Summarise again"}>
                <span class="ask-spinner" aria-hidden="true" />
                Summarising…
              </Show>
            </button>
          </Show>
        </div>
        <Show
          when={answer()}
          fallback={<p class="muted">None yet: Summarise writes one from everything on this page.</p>}
        >
          {(written) => (
            <div class="stack summary-answer">
              <p>{written().what}</p>
              <p>
                <strong>Impact</strong> {written().impact}
              </p>
              <p>
                <strong>Cause</strong> {written().cause}
              </p>
              <Show when={written().turns.length > 0}>
                <ol class="summary-turns">
                  <For each={written().turns}>
                    {(turn) => (
                      <li>
                        <span class="mono">{clock(turn.at)}</span> {turn.text}
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
              <Show when={written().followUps.length > 0}>
                <ul class="summary-follow-ups">
                  <For each={written().followUps}>{(each) => <li>{each}</li>}</For>
                </ul>
              </Show>
              <p class="muted ask-meta">
                {written().confidence} confidence · {written().model} · {spent(written())}
              </p>
              <Show when={mayWrite()}>
                <button type="button" class="plain-button" disabled={kept()} onClick={() => keep(written())}>
                  {kept() ? "Kept as a note" : "Keep as note"}
                </button>
              </Show>
            </div>
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
    </Show>
  )
}
