/** @jsxImportSource solid-js */
/** Alerts that are one problem, as one row: an incident's, or a service's or store's, opening to their rows. */
import { For, Show } from "solid-js"
import { useEstate } from "../context"
import { cardFold } from "../fold"
import { clock, since } from "../format"
import type { Grouped } from "../grouped"
import { A } from "./A"
import { LatestNote, SeverityDot } from "./AlertLine"
import { AlertRow, type Shown } from "./AlertRows"

type Group = Exclude<Grouped, { readonly kind: "alert" }>

export const AlertGroup = (props: Shown & { readonly group: Group }) => {
  const { actions, now } = useEstate()
  const [open, setOpen] = cardFold(actions, `${props.group.key} group`)
  const rows = () => `rows-${props.group.key.replace(/[^\w-]/g, "-")}`
  const worst = () => props.group.alerts[0]
  const newest = () =>
    props.group.alerts
      .flatMap((alert) => alert.notes)
      .reduce<(typeof props.group.alerts)[number]["notes"][number] | undefined>(
        (latest, note) => (latest === undefined || note.at > latest.at ? note : latest),
        undefined,
      )
  return (
    <li class="alert-group">
      <div class={`alert-row${worst()?.severity === "critical" ? " critical" : ""}`}>
        <button
          type="button"
          class="row-toggle"
          aria-expanded={open()}
          aria-controls={rows()}
          onClick={() => setOpen(!open())}
        >
          <span class="visually-hidden">
            {props.group.title}, {props.group.alerts.length} alerts, worst {worst()?.severity}
          </span>
        </button>
        <A to={props.group.to} class="row-name">
          {props.group.title}
        </A>
        <span class="row-where">
          {props.group.kind} · {props.group.alerts.length} alerts
        </span>
        <Show when={worst()}>
          {(alert) => (
            <span class="row-severity">
              <SeverityDot alert={alert()} />
              {alert().severity}
            </span>
          )}
        </Show>
        <span class="row-since">
          {props.group.kind === "incident"
            ? `open ${since(props.group.since, now())}`
            : `since ${clock(props.group.since)}`}
        </span>
        <Show when={props.group.kind === "incident"}>
          <span class="row-note">
            latest: <LatestNote note={newest()} />
          </span>
        </Show>
      </div>
      <Show when={open()}>
        <ul id={rows()} class="alert-rows nested">
          <For each={props.group.alerts}>
            {(alert) => <AlertRow alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
          </For>
        </ul>
      </Show>
    </li>
  )
}
