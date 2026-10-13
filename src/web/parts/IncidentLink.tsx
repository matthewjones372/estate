/** @jsxImportSource solid-js */
/**
 * An alert card's incident: which one it is part of, and for operators *Link to incident…*, a chooser of the incidents
 * open now and *New incident*. The card follows from the alerts the server sends, so a link done here shows there.
 */
import { createSignal, For, onMount, Show } from "solid-js"
import type { Alert, Me } from "../../shared/events"
import type { Incident } from "../../shared/incidents"
import { useEstate } from "../context"
import { pathOf } from "../route"
import { A } from "./A"

/** The server's longest title, so the box stops where the server would refuse. */
const longestTitle = 200

export const PartOf = (props: { readonly alert: Alert }) => (
  <Show when={props.alert.incident}>
    {(incident) => (
      <p class="alert-detail incident-part">
        Part of{" "}
        <A to={pathOf({ page: "incident", id: incident().id })}>
          <em>{incident().title}</em>
        </A>
        {incident().closed ? " (closed)" : ""}
      </p>
    )}
  </Show>
)

/** Whether this person may link firings into incidents: an operator, where Estate writes. */
export const canKeepIncidents = (me: Me) => me.role === "operator" && me.readOnly !== true && me.kiosk !== true

export const LinkToIncident = (props: { readonly onOpen: () => void }) => {
  const { me } = useEstate()
  return (
    <Show when={canKeepIncidents(me)}>
      <button type="button" class="amber-button ghost" onClick={() => props.onOpen()}>
        Link to incident…
      </button>
    </Show>
  )
}

const Busy = (props: { readonly text: string }) => (
  <>
    <span class="ask-spinner" aria-hidden="true" />
    {props.text}
  </>
)

export const IncidentChooser = (props: { readonly alert: Alert; readonly close: () => void }) => {
  const { actions } = useEstate()
  const [open, setOpen] = createSignal<ReadonlyArray<Incident> | "reading" | undefined>("reading")
  void actions.incidents().then((found) => setOpen(found))
  const [title, setTitle] = createSignal("")
  /** The incident being linked to, or "new" while one is opened. */
  const [busy, setBusy] = createSignal<string | undefined>(undefined)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  // The open incident it is already part of is where it is; linking it there again does nothing.
  const offered = () => {
    const read = open()
    const current = props.alert.incident
    const here = current === undefined || current.closed ? undefined : current.id
    return typeof read === "object" ? read.filter((each) => each.id !== here) : []
  }
  const done = (result: Incident | string) => {
    setBusy(undefined)
    if (typeof result === "string") setRefused(result)
    else props.close()
  }
  const begin = (what: string) => {
    setBusy(what)
    setRefused(undefined)
  }
  const link = (incident: Incident) => {
    if (busy() !== undefined) return
    begin(incident.id)
    void actions.linkIncident(incident.id, props.alert.id).then(done)
  }
  const start = () => {
    const named = title().trim()
    if (named === "" || busy() !== undefined) return
    begin("new")
    void actions.openIncident(named, props.alert.id).then(done)
  }
  return (
    <fieldset class="silencing incident-chooser" aria-busy={busy() !== undefined}>
      <legend style={{ "font-size": "13px", "font-weight": 600, padding: 0 }}>
        Link {props.alert.name} to an incident
      </legend>
      <Show when={open() !== "reading"} fallback={<p class="alert-quiet">Reading the open incidents…</p>}>
        <Show when={open() !== undefined} fallback={<p class="alert-detail">The open incidents could not be read.</p>}>
          <Show when={offered().length > 0} fallback={<p class="alert-quiet">No other incident is open.</p>}>
            <div class="choices">
              <For each={offered()}>
                {(incident) => (
                  <button
                    type="button"
                    class="choice incident-choice"
                    disabled={busy() !== undefined}
                    aria-busy={busy() === incident.id}
                    onClick={() => link(incident)}
                  >
                    <Show when={busy() === incident.id} fallback={incident.title}>
                      <Busy text={`Linking to ${incident.title}…`} />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
      <label class="reason">
        Or a new incident, titled
        <input
          // The button that opened the chooser is gone, so the focus comes here rather than to the page.
          ref={(box) => onMount(() => box.focus())}
          type="text"
          value={title()}
          maxLength={longestTitle}
          onInput={(event) => setTitle(event.currentTarget.value)}
          placeholder="e.g. Chip registry slow"
          class="amber-input"
        />
      </label>
      <div class="choices">
        <button
          type="button"
          class="primary-button"
          disabled={title().trim() === "" || busy() !== undefined}
          aria-busy={busy() === "new"}
          onClick={start}
        >
          <Show when={busy() === "new"} fallback="New incident">
            <Busy text="Opening…" />
          </Show>
        </button>
        <button type="button" class="amber-button ghost" onClick={() => props.close()}>
          Cancel
        </button>
      </div>
      <Show when={refused()}>
        {(why) => (
          <p class="alert-detail" role="alert">
            {why()}
          </p>
        )}
      </Show>
    </fieldset>
  )
}
