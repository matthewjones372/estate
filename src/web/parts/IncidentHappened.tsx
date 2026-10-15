/** @jsxImportSource solid-js */
/**
 * *Add what happened*: a line on an open incident for what Estate cannot see, at the time it happened, now unless
 * given. Anyone who may write adds one; the server keeps who and when, and refuses a time outside the window.
 */
import { createSignal, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import { longestNote } from "../../shared/note"
import { useEstate } from "../context"

export const IncidentHappened = (props: {
  readonly incident: Incident
  /** Reads the incident again once a line is kept. */
  readonly changed: () => void
}) => {
  const { actions, me } = useEstate()
  const [text, setText] = createSignal("")
  // The browser's local time, as a datetime-local input gives it; empty for now.
  const [when, setWhen] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const add = () => {
    const line = text().trim()
    if (line === "" || busy()) return
    setBusy(true)
    setRefused(undefined)
    const at = when() === "" ? undefined : new Date(when()).toISOString()
    void actions.addIncidentHappened(props.incident.id, line, at).then((result) => {
      setBusy(false)
      if (result !== true) setRefused(result)
      else {
        setText("")
        setWhen("")
        props.changed()
      }
    })
  }
  return (
    <Show when={props.incident.closedAt === undefined && me.readOnly !== true && me.kiosk !== true}>
      <form
        class="note-form incident-happened"
        aria-busy={busy()}
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <label class="note-label">
          <span class="visually-hidden">What happened</span>
          <input
            type="text"
            value={text()}
            maxLength={longestNote}
            onInput={(event) => setText(event.currentTarget.value)}
            placeholder="What happened that Estate cannot see, e.g. rolled the registry back by hand"
            class="amber-input"
          />
        </label>
        <label class="note-label">
          <span class="visually-hidden">When it happened, now if left empty</span>
          <input
            type="datetime-local"
            value={when()}
            onInput={(event) => setWhen(event.currentTarget.value)}
            class="amber-input"
          />
        </label>
        <button type="submit" class="amber-button" disabled={busy()} aria-busy={busy()}>
          Add what happened
        </button>
      </form>
      <Show when={refused()}>
        {(why) => (
          <p class="alert-detail" role="alert">
            {why()}
          </p>
        )}
      </Show>
    </Show>
  )
}
