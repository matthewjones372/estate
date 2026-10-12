/** @jsxImportSource solid-js */
/**
 * An alert's notes on its card, with its incident's among them: the newest few, *Show all*, each with who and when,
 * and a box to add one to the alert.
 */
import { createSignal, For, Show } from "solid-js"
import type { Alert, Me } from "../../shared/events"
import { useEstate } from "../context"
import { initials, stamp } from "../format"
import { allNotesShown, NoteText } from "./NoteText"

/** A card shows its newest notes; the rest wait for *Show all*. */
const newest = 3

type CardNote = Alert["notes"][number]

/** Whether this person may take a note back: its author or an operator; an incident's only while it is open. */
const removable = (note: CardNote, alert: Alert, me: Me) =>
  (note.by === me.name || me.role === "operator") &&
  (note.incident === undefined || (alert.incident?.closed !== true && me.readOnly !== true && me.kiosk !== true))

export const Notes = (props: { readonly alert: Alert }) => {
  const { actions, me, now } = useEstate()
  const [draft, setDraft] = createSignal("")
  const notes = () => props.alert.notes
  const [all, setAll] = allNotesShown(actions, `${props.alert.id} ${props.alert.startsAt}`)
  const shown = () => (all() ? notes() : notes().slice(0, newest))
  const post = () => {
    const text = draft().trim()
    if (text === "") return
    void actions.addNote(props.alert.id, text).then((added) => {
      if (added) setDraft("")
    })
  }
  const remove = (note: CardNote) => {
    if (note.incident === undefined) void actions.removeNote(note.id)
    else void actions.removeIncidentNote(note.incident.id, note.id)
  }
  return (
    <div class="alert-notes">
      <div class="spread">
        <span class="alert-label">Notes</span>
        <span class="alert-quiet">
          {notes().length === 0 ? "none yet" : `${notes().length} note${notes().length > 1 ? "s" : ""}`}
        </span>
      </div>
      <For each={shown()}>
        {(note) => (
          <div class="note">
            <span class="note-avatar" aria-hidden="true">
              {initials(note.by)}
            </span>
            <div style={{ "min-width": 0 }}>
              <div class="alert-quiet">
                <strong class="note-who">{note.by}</strong> · {stamp(note.at, now())}
                <Show when={note.incident}>
                  {(incident) => (
                    <>
                      {" · on "}
                      <em>{incident().title}</em>
                    </>
                  )}
                </Show>
                <Show when={removable(note, props.alert, me)}>
                  {" · "}
                  <button type="button" class="note-remove" onClick={() => remove(note)}>
                    Remove<span class="visually-hidden"> the note by {note.by}</span>
                  </button>
                </Show>
              </div>
              <NoteText text={note.text} />
            </div>
          </div>
        )}
      </For>
      <Show when={notes().length > newest}>
        <button type="button" class="note-more" aria-expanded={all()} onClick={() => setAll(!all())}>
          {all() ? "Show fewer" : `Show all ${notes().length} notes`}
        </button>
      </Show>
      <form
        class="note-form"
        onSubmit={(event) => {
          event.preventDefault()
          post()
        }}
      >
        <label class="note-label">
          <span class="visually-hidden">Add a note to {props.alert.name}</span>
          <input
            type="text"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder="What you found, or that you are on it"
            class="amber-input"
          />
        </label>
        <button type="submit" class="amber-button">
          Add note
        </button>
      </form>
    </div>
  )
}
