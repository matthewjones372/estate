/** @jsxImportSource solid-js */
/**
 * One past firing of an alert, to look back at: what happened, as Estate kept it. Nothing on it is live; it is read
 * once, for the environment the page is in.
 */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { PastFiring } from "../../shared/firing"
import { useEstate, useSnapshot } from "../context"
import { clock, day, duration } from "../format"
import { A, Out } from "../parts/A"
import { firingPath } from "../route"

const lede = (firing: PastFiring) =>
  [
    `${firing.severity === undefined ? "" : `${firing.severity} · `}fired ${day(firing.startsAt)}${
      firing.endsAt === undefined
        ? ", its end not seen"
        : ` for ${duration(Date.parse(firing.endsAt) - Date.parse(firing.startsAt))}, ended ${clock(firing.endsAt)}`
    }`,
    firing.service ?? firing.store,
    firing.environment,
  ]
    .filter((part) => part !== undefined)
    .join(" · ")

const WhatHappened = (props: { readonly firing: PastFiring }) => (
  <section aria-labelledby="firing-happened" class="stack">
    <h1 id="firing-happened" class="headline" style={{ "font-size": "32px" }}>
      What happened
    </h1>
    <p class="lede">{lede(props.firing)}</p>
    <Show
      when={props.firing.severity !== undefined}
      fallback={
        <p class="muted">Kept before Estate kept what an alert said, so its severity and summary are not known.</p>
      }
    >
      <Show when={props.firing.summary}>{(summary) => <p>{summary()}</p>}</Show>
    </Show>
    <Show when={props.firing.impact}>
      {(impact) => (
        <p class="alert-impact">
          <span class="alert-label">Impact</span>
          <span>{impact().text}</span>
        </p>
      )}
    </Show>
    <Show when={props.firing.silence}>
      {(silence) => (
        <p class="alert-detail">
          Silenced by {silence().by}: “{silence().reason}”
        </p>
      )}
    </Show>
    <Show when={props.firing.notes.length > 0}>
      <div class="alert-notes">
        <span class="alert-label">Notes</span>
        <For each={props.firing.notes}>
          {(note) => (
            <p class="alert-detail">
              “{note.text}” — {note.by}, {clock(note.at)}
            </p>
          )}
        </For>
      </div>
    </Show>
    <Show when={props.firing.runbook}>
      {(runbook) => (
        <div class="choices">
          <Out href={runbook()} class="primary-button">
            Open the runbook
          </Out>
        </div>
      )}
    </Show>
    <Show when={props.firing.others.length > 0}>
      <nav aria-label={`Other firings of ${props.firing.name}`} class="stack" style={{ gap: "4px" }}>
        <span class="alert-label">
          Fired {props.firing.others.length} other time{props.firing.others.length === 1 ? "" : "s"} here
        </span>
        <For each={props.firing.others}>{(at) => <A to={firingPath(props.firing.alert, at)}>{day(at)}</A>}</For>
      </nav>
    </Show>
  </section>
)

export const FiringPage = (props: { readonly id: string; readonly at: string }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [read, setRead] = createSignal<PastFiring | "none" | "loading" | undefined>("loading")
  createEffect(
    on([() => props.id, () => props.at, () => snapshot.environment], ([id, at]) => {
      let current = true
      setRead("loading")
      void actions.firing(id, at).then((found) => {
        if (current) setRead(found)
      })
      onCleanup(() => {
        current = false
      })
    }),
  )
  const found = () => {
    const value = read()
    return typeof value === "object" ? value : undefined
  }
  return (
    <Show
      when={found()}
      fallback={
        <main class="state-page">
          <p class="muted">
            {read() === "loading"
              ? "Reading the firing…"
              : read() === "none"
                ? `${props.id}'s firing at ${day(props.at)} is not kept here.`
                : "The firing could not be read."}
          </p>
          <A to="/alerts">All alerts, and what resolved today</A>
        </main>
      }
    >
      {(firing) => (
        <main class="main">
          <nav aria-label="Breadcrumb" class="muted crumbs">
            <A to="/">Overview</A> / <A to="/alerts">Alerts</A> / {firing().name} · {day(firing().startsAt)}
          </nav>
          <WhatHappened firing={firing()} />
        </main>
      )}
    </Show>
  )
}
