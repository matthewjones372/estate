/** @jsxImportSource solid-js */
/** *Around this alert* on its page, and the line on its card that says what was deployed just before it fired. */
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import type { AroundAlert } from "../../shared/around"
import type { Alert } from "../../shared/events"
import { changesNear, neighboursOf } from "../around"
import { useEstate, useSnapshot } from "../context"
import { since } from "../format"
import { Brief } from "./Brief"

/** The brief, read from the server when the alert's page opens, so it costs nothing until someone looks. */
export const Around = (props: { readonly alert: Alert }) => {
  const { actions } = useEstate()
  const [brief, setBrief] = createSignal<AroundAlert | "loading" | "failed">("loading")
  createEffect(
    on(
      () => props.alert.id,
      (id) => {
        let current = true
        setBrief("loading")
        void actions.around(id).then((read) => {
          if (current) setBrief(read ?? "failed")
        })
        onCleanup(() => {
          current = false
        })
      },
    ),
  )
  const read = () => {
    const value = brief()
    return typeof value === "object" ? value : undefined
  }
  return (
    <section class="alert-around" aria-label={`Around ${props.alert.name}`}>
      <Show
        when={read()}
        fallback={
          <p class="muted" style={{ margin: 0 }}>
            {brief() === "loading" ? "Gathering what is around it…" : "Estate could not gather what is around it."}
          </p>
        }
      >
        {(found) => <Brief brief={found()} />}
      </Show>
    </section>
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
