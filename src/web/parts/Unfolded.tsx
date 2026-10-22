/** @jsxImportSource solid-js */
/** How the open incident unfolded, oldest first, then a box to add a note to it (spec 0068). */
import { createSignal, For, Show } from "solid-js"
import { longestNote } from "../../shared/note"
import { useEstate } from "../context"
import { stamp } from "../format"
import type { Thing } from "../needs"
import { unfoldedOf } from "../unfolded"
import { NoteText } from "./NoteText"

export const Unfolded = (props: { readonly incident: Thing }) => {
  const { actions, me, now } = useEstate()
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const id = () => props.incident.alerts[0]?.incident?.id ?? ""
  const told = () => unfoldedOf(id(), props.incident.alerts)
  const writes = () => me.readOnly !== true && me.kiosk !== true
  const post = () => {
    const text = draft().trim()
    if (text === "" || busy()) return
    setBusy(true)
    setRefused(undefined)
    void actions.addIncidentNote(id(), text).then((result) => {
      setBusy(false)
      if (typeof result === "string") setRefused(result)
      else setDraft("")
    })
  }
  return (
    <section aria-labelledby="unfolded" class="panel section-box stack unfolded" aria-busy={busy()}>
      <div class="spread">
        <h2 id="unfolded" class="needs-title">
          How it unfolded
        </h2>
        <span class="muted small">{props.incident.title} · oldest first</span>
      </div>
      <ol class="unfolded-list">
        <For each={told()}>
          {(each) => (
            <li
              class={
                each.kind === "fired"
                  ? `told-fired ${each.alert.severity === "critical" ? "critical" : "attention"}`
                  : "told-note"
              }
            >
              <span class="mono muted small">{stamp(each.at, now())}</span>
              <span class="told-dot" aria-hidden="true" />
              <span>
                <Show
                  when={each.kind === "fired" ? each : undefined}
                  fallback={
                    <>
                      <strong class="told-who">{each.kind === "note" ? each.by : ""}</strong>
                      <NoteText text={each.kind === "note" ? each.text : ""} />
                    </>
                  }
                >
                  {(fired) => (
                    <>
                      <strong class="told-who">Alert fired</strong>
                      <span>
                        {fired().alert.name}
                        {fired().alert.summary === undefined ? "" : `: ${fired().alert.summary}`}
                      </span>
                    </>
                  )}
                </Show>
              </span>
            </li>
          )}
        </For>
      </ol>
      <Show when={writes()}>
        <form
          class="note-form"
          onSubmit={(event) => {
            event.preventDefault()
            post()
          }}
        >
          <label class="note-label">
            <span class="visually-hidden">Add a note to {props.incident.title}</span>
            <input
              type="text"
              value={draft()}
              maxLength={longestNote}
              onInput={(event) => setDraft(event.currentTarget.value)}
              placeholder="Add a note for whoever looks next"
              class="amber-input"
            />
          </label>
          <button type="submit" class="amber-button" disabled={busy()} aria-busy={busy()}>
            {busy() ? "Adding…" : "Add note"}
          </button>
        </form>
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
