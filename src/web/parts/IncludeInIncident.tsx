/** @jsxImportSource solid-js */
/**
 * *Include in incident* (spec 0051): what the page shows, kept in one of the incidents open now with a line on why.
 * Offered to anyone who may write, while an incident is open; a screen and a read-only Estate change nothing. Several
 * things picked together (spec 0063) go in one press, stopping at the first the server refuses.
 */
import { createSignal, For, onMount, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import type { Included } from "../../shared/included"
import { type Actions, useEstate } from "../context"

/** The incidents open now, read once for every button on a page within a few seconds of each other. */
const shared = new WeakMap<Actions, { readonly at: number; readonly read: Promise<ReadonlyArray<Incident>> }>()
const openNow = (actions: Actions, now: number) => {
  const held = shared.get(actions)
  if (held !== undefined && now - held.at < 5000) return held.read
  const read = actions.incidents().then((found) => found ?? [])
  shared.set(actions, { at: now, read })
  return read
}

export const IncludeInIncident = (props: {
  readonly label: string
  readonly what: () => Included | ReadonlyArray<Included>
  /** Said while choosing, when what goes is picked on the page. */
  readonly hint?: string
  readonly onChoosing?: (choosing: boolean) => void
}) => {
  const { me, actions } = useEstate()
  const [open, setOpen] = createSignal<ReadonlyArray<Incident>>([])
  const [choosing, setChosen] = createSignal(false)
  const setChoosing = (now: boolean) => {
    setChosen(now)
    props.onChoosing?.(now)
  }
  const all = (): ReadonlyArray<Included> => {
    const what = props.what()
    return "kind" in what ? [what] : what
  }
  const [why, setWhy] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [told, setTold] = createSignal("")
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  onMount(() => {
    if (me.kiosk !== true && me.readOnly !== true) void openNow(actions, Date.now()).then(setOpen)
  })
  const include = (incident: Incident) => {
    const going = all()
    if (busy() || going.length === 0) return
    setBusy(true)
    setRefused(undefined)
    const reason = why().trim()
    const each = (index: number): Promise<string | undefined> => {
      const what = going[index]
      if (what === undefined) return Promise.resolve(undefined)
      return actions
        .include(incident.id, { ...what, ...(reason === "" ? {} : { why: reason }) })
        .then((kept) => (typeof kept === "string" ? kept : each(index + 1)))
    }
    void each(0).then((said) => {
      setBusy(false)
      if (said !== undefined) {
        setRefused(said)
        return
      }
      setChoosing(false)
      setWhy("")
      setTold(`Included in ${incident.title}`)
    })
  }
  return (
    <Show when={open().length > 0}>
      <Show
        when={choosing()}
        fallback={
          <>
            <button type="button" class="plain-button" onClick={() => setChoosing(true)}>
              {props.label}
            </button>
            <span class="include-told log-told" role="status">
              {told()}
            </span>
          </>
        }
      >
        <fieldset class="silencing include-chooser" aria-busy={busy()}>
          <legend class="visually-hidden">{props.label}</legend>
          <Show when={props.hint}>{(hint) => <p class="muted flush">{hint()}</p>}</Show>
          <label class="reason include-why">
            Why, if you want to say
            <input
              type="text"
              class="amber-input"
              value={why()}
              maxLength={200}
              placeholder="e.g. the queue starts climbing here"
              onInput={(event) => setWhy(event.currentTarget.value)}
            />
          </label>
          <div class="choices">
            <For each={open()}>
              {(incident) => (
                <button
                  type="button"
                  class="choice"
                  disabled={busy() || all().length === 0}
                  onClick={() => include(incident)}
                >
                  Include {all().length > 1 ? `${all().length} ` : ""}in {incident.title}
                </button>
              )}
            </For>
            <button type="button" class="amber-button ghost" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
          <Show when={refused()}>
            {(said) => (
              <p class="alert-detail" role="alert">
                {said()}
              </p>
            )}
          </Show>
        </fieldset>
      </Show>
    </Show>
  )
}
