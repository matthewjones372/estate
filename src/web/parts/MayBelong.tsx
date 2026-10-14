/** @jsxImportSource solid-js */
/**
 * The open incident a firing may belong to (spec 0042), for someone who may link it: the incident, why, and *Link* or
 * *Not this*. A suggestion is a line, never a link made by itself; the line goes once the server's alerts say so.
 */
import { createSignal, Show } from "solid-js"
import type { Suggested } from "../../shared/incidents"
import { useEstate } from "../context"
import { canKeepIncidents } from "./IncidentLink"

/** When it fired against the incident's firing, in minutes. */
const whenOf = (apart: number) =>
  apart === 0 ? "in the same minute as" : `${Math.abs(apart)} min ${apart > 0 ? "after" : "before"}`

/** Why it may belong, in the page's words: how the two are related, then when it fired. */
export const reasonOf = (suggested: Suggested, subject: string | undefined) => {
  const { to } = suggested
  const when = whenOf(suggested.apart)
  switch (suggested.why) {
    case "same alert":
      return `the same alert is part of it in ${to.environment}, and this one fired ${when} it`
    case "same service":
    case "same store":
      return `it is on ${to.about ?? subject} too, and it fired ${when} ${to.name}`
    case "next to it": {
      const [from, other] = suggested.side === "called by" ? [to.about, subject] : [subject, to.about]
      return `${from} calls ${other}, and it fired ${when} ${to.name}`
    }
  }
}

/** A suggestion's line, *Link* and *Not this*, and why either was refused; `done` once either is. */
export const Suggestion = (props: {
  readonly line: string
  readonly incident: string
  readonly alert: string
  /** The firing's environment, where it is not the page's. */
  readonly environment?: string
  readonly done?: () => void
}) => {
  const { actions } = useEstate()
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const act = (write: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    setRefused(undefined)
    void write().then((result) => {
      setBusy(false)
      if (typeof result === "string") setRefused(result)
      else props.done?.()
    })
  }
  return (
    <>
      <p>{props.line}</p>
      <div class="choices" aria-busy={busy()}>
        <button
          type="button"
          class="amber-button ghost"
          disabled={busy()}
          onClick={() => act(() => actions.linkIncident(props.incident, props.alert, props.environment))}
        >
          Link
        </button>
        <button
          type="button"
          class="amber-button ghost"
          disabled={busy()}
          onClick={() => act(() => actions.dismissIncident(props.incident, props.alert, props.environment))}
        >
          Not this
        </button>
      </div>
      <Show when={refused()}>
        {(why) => (
          <p class="alert-detail" role="alert">
            {why()}
          </p>
        )}
      </Show>
    </>
  )
}

/** On an alert's card, for someone who may link: the open incident it may be part of, and why. */
export const MayBelong = (props: {
  readonly suggested: Suggested | undefined
  /** The firing's service or store, which the reason names. */
  readonly subject: string | undefined
  readonly alert: string
}) => {
  const { me } = useEstate()
  return (
    <Show when={canKeepIncidents(me) ? props.suggested : undefined}>
      {(suggested) => (
        <div class="alert-detail incident-suggested">
          <Suggestion
            line={`May be part of "${suggested().incident.title}": ${reasonOf(suggested(), props.subject)}.`}
            incident={suggested().incident.id}
            alert={props.alert}
          />
        </div>
      )}
    </Show>
  )
}
