/** @jsxImportSource solid-js */
/**
 * Notes written on an incident, newest first, which each of its firings' cards shows too. Anyone who may write adds
 * one while it is open; its author or an operator takes one back. A closed incident's notes are its record.
 */
import { createSignal, For, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import { longestNote } from "../../shared/note"
import { useEstate } from "../context"
import { initials, stamp } from "../format"
import { NoteText } from "./NoteText"

export const IncidentNotes = (props: {
  readonly incident: Incident
  /** Reads the incident again once a note is added or removed. */
  readonly changed: () => void
}) => {
  const { actions, me, now } = useEstate()
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const notes = () => (props.incident.notes ?? []).toSorted((a, b) => b.at.localeCompare(a.at))
  const writes = () => props.incident.closedAt === undefined && me.readOnly !== true && me.kiosk !== true
  const done = (result: Incident | string) => {
    setBusy(false)
    if (typeof result === "string") setRefused(result)
    else props.changed()
    return typeof result !== "string"
  }
  const begin = () => {
    setBusy(true)
    setRefused(undefined)
  }
  const post = () => {
    const text = draft().trim()
    if (text === "" || busy()) return
    begin()
    void actions.addIncidentNote(props.incident.id, text).then((result) => {
      if (done(result)) setDraft("")
    })
  }
  const remove = (note: string) => {
    if (busy()) return
    begin()
    void actions.removeIncidentNote(props.incident.id, note).then(done)
  }
  return (
    <section aria-labelledby="incident-notes" class="panel section-box stack incident-notes" aria-busy={busy()}>
      <h2 id="incident-notes" class="section-title">
        Notes
      </h2>
      <Show when={notes().length > 0} fallback={<p class="muted">No notes were written on it.</p>}>
        <For each={notes()}>
          {(note) => (
            <div class="note">
              <span class="note-avatar" aria-hidden="true">
                {initials(note.by)}
              </span>
              <div style={{ "min-width": 0 }}>
                <div class="alert-quiet">
                  <strong class="note-who">{note.by}</strong> · {stamp(note.at, now())}
                  <Show when={writes() && (note.by === me.name || me.role === "operator")}>
                    {" · "}
                    <button type="button" class="note-remove" disabled={busy()} onClick={() => remove(note.id)}>
                      Remove<span class="visually-hidden"> the note by {note.by}</span>
                    </button>
                  </Show>
                </div>
                <NoteText text={note.text} />
              </div>
            </div>
          )}
        </For>
      </Show>
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
              placeholder="What you found, shown on each of its firings"
              class="amber-input"
            />
          </label>
          <button type="submit" class="amber-button" disabled={busy()} aria-busy={busy()}>
            <Show when={busy()} fallback="Add note">
              <span class="ask-spinner" aria-hidden="true" />
              Adding…
            </Show>
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
