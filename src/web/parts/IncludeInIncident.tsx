/** @jsxImportSource solid-js */
/**
 * *Include in incident* (spec 0051): what the page shows, kept in one of the incidents open now with a line on why.
 * Offered to anyone who may write, while an incident is open; a screen and a read-only Estate change nothing.
 */
import { createSignal, For, onMount, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import type { Included } from "../../shared/included"
import { useEstate } from "../context"

export const IncludeInIncident = (props: { readonly label: string; readonly what: () => Included }) => {
  const { me, actions } = useEstate()
  const [open, setOpen] = createSignal<ReadonlyArray<Incident>>([])
  const [choosing, setChoosing] = createSignal(false)
  const [why, setWhy] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [told, setTold] = createSignal("")
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  onMount(() => {
    if (me.kiosk !== true && me.readOnly !== true) void actions.incidents().then((found) => setOpen(found ?? []))
  })
  const include = (incident: Incident) => {
    if (busy()) return
    setBusy(true)
    setRefused(undefined)
    const reason = why().trim()
    void actions.include(incident.id, { ...props.what(), ...(reason === "" ? {} : { why: reason }) }).then((kept) => {
      setBusy(false)
      if (typeof kept === "string") {
        setRefused(kept)
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
                <button type="button" class="choice" disabled={busy()} onClick={() => include(incident)}>
                  Include in {incident.title}
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
