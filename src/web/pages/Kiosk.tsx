/** @jsxImportSource solid-js */
/**
 * The estate on a screen on the wall: what needs someone, and every service worst first, in type read from across a
 * room. Nothing to press. Environments take turns; a screen that has stopped being told says so in red.
 */
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import type { Alert, Health, ServiceState } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { amount, clock, since } from "../format"
import { firingOf, nextOf, staleSince, tilesOf, turnOf } from "../kiosk"
import { Plot } from "../parts/Plot"
import { Spark } from "../parts/Sparkline"
import { headlineOf } from "./Overview"

const hour = 3_600_000

const words: Readonly<Record<Health, string>> = {
  healthy: "Healthy",
  attention: "Degraded",
  critical: "Down",
  unknown: "Unknown",
}

const Card = (props: { readonly alert: Alert; readonly now: number }) => {
  const latest = () => props.alert.notes.at(-1)
  const end = createMemo(
    on(
      () => props.alert.chart?.points,
      () => props.now,
    ),
  )
  return (
    <article class={`kiosk-card ${props.alert.severity === "critical" ? "critical" : "attention"}`}>
      <div class="kiosk-card-top">
        <span class="kiosk-severity">{props.alert.severity}</span>
        <span>{props.alert.service ?? props.alert.name}</span>
        <span class="kiosk-since">firing {since(props.alert.startsAt, props.now)}</span>
      </div>
      <h2>{props.alert.summary ?? props.alert.name}</h2>
      <Show when={props.alert.chart}>
        {(chart) => (
          <Plot
            label={`${props.alert.name} over the last hour against its threshold ${amount(chart().threshold)}`}
            points={chart().points}
            end={end() ?? props.now}
            span={hour}
            width={400}
            height={80}
            pad={6}
            headroom={chart().threshold * 1.25}
            ink="#F5A524"
            fill={0.12}
            limit={{ value: chart().threshold, ink: "#F5A524" }}
            style={{ width: "100%", height: "6em", display: "block" }}
            mark={undefined}
            onMark={() => undefined}
          />
        )}
      </Show>
      <p class="kiosk-note">{latest() === undefined ? "Nobody is on it yet." : `${latest()?.by}: ${latest()?.text}`}</p>
    </article>
  )
}

const Tile = (props: { readonly service: ServiceState }) => (
  <article class={`kiosk-tile ${props.service.health}`}>
    <div class="kiosk-tile-name">
      <span class={`dot ${props.service.health}`} />
      {props.service.name}
    </div>
    <div class={`kiosk-tile-health ${props.service.health}`}>
      {words[props.service.health]}
      <Show when={props.service.reasons[0]}>{(reason) => <span class="kiosk-reason"> · {reason()}</span>}</Show>
    </div>
    <Spark label="Requests" unit="/s" series={props.service.load.requests} />
  </article>
)

/** Keeps the screen from sleeping where the browser lets a page ask. */
const stayAwake = () => {
  const ask = () => {
    const lock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<unknown> } }).wakeLock
    void lock?.request("screen").catch(() => undefined)
  }
  ask()
  const again = () => document.visibilityState === "visible" && ask()
  document.addEventListener("visibilitychange", again)
  onCleanup(() => document.removeEventListener("visibilitychange", again))
}

export const Kiosk = (props: { readonly team?: string | undefined }) => {
  const { me, actions, now } = useEstate()
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const team = props.team
  const [tick, setTick] = createSignal(now())
  const timer = setInterval(() => setTick(now()), 1000)
  onCleanup(() => clearInterval(timer))
  onMount(stayAwake)

  const environments = me.screen?.environments ?? me.environments
  const every = me.screen?.every ?? 30
  const firing = () => firingOf(events(), team)
  const [chosenAt, setChosenAt] = createSignal(now())
  let turn: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(
      () => [snapshot.environment, firing().length] as const,
      ([environment, count], previous) => {
        if (previous?.[0] !== environment) setChosenAt(now())
        clearTimeout(turn)
        const next = nextOf(environments, environment)
        if (environments.length > 1 && next !== undefined)
          turn = setTimeout(() => actions.choose(next), turnOf(every, count))
      },
    ),
  )
  onCleanup(() => clearTimeout(turn))

  const stale = () => staleSince(snapshot.heardAt, chosenAt(), tick())
  const title = () =>
    events().catalog?.environments.find((each) => each.name === snapshot.environment)?.title ?? snapshot.environment
  const headline = () => headlineOf(events())
  return (
    <main class="kiosk" aria-label={`The estate on a screen: ${title()}`}>
      <header class="kiosk-top">
        <span class="kiosk-environment">{title()}</span>
        <Show when={team}>{(name) => <span class="kiosk-team">{name()}</span>}</Show>
        <span class="kiosk-clock mono">{clock(new Date(tick()).toISOString())}</span>
      </header>
      <Show when={stale()}>
        {(last) => (
          <div class="kiosk-stale" role="alert">
            Not updated since {clock(new Date(last()).toISOString())}
          </div>
        )}
      </Show>
      <section class={`kiosk-now ${headline().tone}`}>
        <span class="kiosk-kicker">{headline().kicker}</span>
        <h1>
          {headline().top} {headline().bottom}
        </h1>
      </section>
      <Show when={firing().length > 0}>
        <section class="kiosk-cards" aria-label="Firing">
          <For each={firing()}>{(alert) => <Card alert={alert} now={tick()} />}</For>
        </section>
      </Show>
      <section class="kiosk-tiles" aria-label="Services">
        <For each={tilesOf(events(), team)}>{(service) => <Tile service={service} />}</For>
      </section>
    </main>
  )
}
