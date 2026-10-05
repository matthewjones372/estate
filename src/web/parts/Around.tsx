/** @jsxImportSource solid-js */
/** What changed near an alert: deploys and builds in the hour before it fired. Useful with no AI set up. */
import { For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { type ChangeNear, changesNear, neighboursOf } from "../around"
import { useSnapshot } from "../context"
import { since } from "../format"
import { A } from "./A"

const lineOf = (change: ChangeNear, firedAt: string): string => {
  const before = Date.parse(firedAt) - Date.parse(change.at)
  const gap = since(change.at, Date.parse(firedAt))
  const when = before >= 0 ? `${gap} before it fired` : `${since(firedAt, Date.parse(change.at))} after it fired`
  return `${change.service} ${change.text} ${when}`
}

export const Around = (props: { readonly alert: Alert }) => {
  const snapshot = useSnapshot()
  const catalog = () => snapshot.events.catalog
  const deploys = () => snapshot.events.deploys
  const environment = () => catalog()?.environment
  const neighbours = () => neighboursOf(catalog(), props.alert.service)
  const changes = () => changesNear(props.alert.startsAt, props.alert.service, deploys(), environment(), neighbours())
  return (
    <div class="alert-around">
      <span class="alert-label">Around this alert</span>
      <Show
        when={props.alert.service !== undefined}
        fallback={<p class="alert-detail muted">No service is named on this alert, so nothing nearby to correlate.</p>}
      >
        <Show
          when={changes().length > 0}
          fallback={
            <p class="alert-detail">
              No deploys or builds of {props.alert.service}
              {neighbours().length === 0 ? "" : ` (or ${neighbours().join(", ")})`} in the hour before it fired.
            </p>
          }
        >
          <ul class="around-list">
            <For each={changes()}>{(change) => <li>{lineOf(change, props.alert.startsAt)}</li>}</For>
          </ul>
        </Show>
        <Show when={props.alert.service}>
          {(name) => (
            <p class="alert-quiet">
              <A to={`/services/${encodeURIComponent(name())}`}>{name()}</A>
              {" \u00b7 "}
              look at deploys and builds for what changed
            </p>
          )}
        </Show>
      </Show>
    </div>
  )
}

/** A compact one-liner for cards: the nearest deploy, or that nothing deployed in the hour before. */
export const AroundLine = (props: { readonly alert: Alert }) => {
  const snapshot = useSnapshot()
  const catalog = () => snapshot.events.catalog
  const changes = () =>
    changesNear(
      props.alert.startsAt,
      props.alert.service,
      snapshot.events.deploys,
      catalog()?.environment,
      neighboursOf(catalog(), props.alert.service),
    )
  const nearest = () => changes()[0]
  return (
    <Show when={props.alert.service !== undefined}>
      <p class="alert-detail around-line">
        <Show when={nearest()} fallback={<>No deploys in the hour before it fired.</>}>
          {(change) => (
            <>
              {change().service} {change().text} {since(change().at, Date.parse(props.alert.startsAt))} before it fired.
            </>
          )}
        </Show>
      </p>
    </Show>
  )
}
