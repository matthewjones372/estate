/** @jsxImportSource solid-js */
/**
 * Many alerts at once: past a few firing, a row each, worst first, that opens its card in place; a few, their cards.
 * Which rows are open is kept while Estate is open in the tab.
 */
import { For, Show } from "solid-js"
import type { Alert, CatalogEvent } from "../../shared/events"
import { useEstate } from "../context"
import { cardFold } from "../fold"
import { since } from "../format"
import { pathOf } from "../route"
import { A } from "./A"
import { AlertCard } from "./AlertCard"
import { LatestNote, SeverityDot, worstFirst } from "./AlertLine"

/** More firing than this, and they are rows: two cards fill a laptop's width, four are about a screen. */
const fewest = 3

/** Whether these many firing show as rows rather than cards. */
export const asRows = (alerts: ReadonlyArray<Alert>) => alerts.length > fewest

interface Shown {
  readonly catalog: CatalogEvent | undefined
  readonly canSilence: boolean
}

const AlertRow = (props: Shown & { readonly alert: Alert }) => {
  const { actions, now } = useEstate()
  const [open, setOpen] = cardFold(actions, `${props.alert.id} ${props.alert.startsAt} row`)
  const card = () => `card-${props.alert.id.replace(/[^\w-]/g, "-")}`
  let toggle: HTMLButtonElement | undefined
  const close = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    setOpen(false)
    toggle?.focus()
  }
  return (
    <li>
      <div class={`alert-row${props.alert.severity === "critical" ? " critical" : ""}`}>
        <button
          ref={toggle}
          type="button"
          class="row-toggle"
          aria-expanded={open()}
          aria-controls={card()}
          onClick={() => setOpen(!open())}
        >
          <span class="visually-hidden">
            {open() ? "Close" : "Open"} {props.alert.name}'s card
          </span>
        </button>
        <span class="row-severity">
          <SeverityDot alert={props.alert} />
          {props.alert.severity}
        </span>
        <A to={`/alerts/${encodeURIComponent(props.alert.id)}`} class="mono row-name">
          {props.alert.name}
        </A>
        <span class="row-where">{props.alert.service ?? props.alert.store ?? ""}</span>
        <span class="row-since mono">{since(props.alert.startsAt, now())}</span>
        <span class="row-note">
          <LatestNote alert={props.alert} />
        </span>
        <Show when={props.alert.incident}>
          {(incident) => (
            <span class="row-incident">
              Part of{" "}
              <A to={pathOf({ page: "incident", id: incident().id })}>
                <em>{incident().title}</em>
              </A>
            </span>
          )}
        </Show>
      </div>
      <Show when={open()}>
        <section id={card()} class="row-card" aria-label={`${props.alert.name}'s card`} onKeyDown={close}>
          <AlertCard alert={props.alert} catalog={props.catalog} canSilence={props.canSilence} />
        </section>
      </Show>
    </li>
  )
}

/** The firing alerts as cards, or past a few as rows. */
export const FiringAlerts = (props: Shown & { readonly alerts: ReadonlyArray<Alert> }) => (
  <Show
    when={asRows(props.alerts)}
    fallback={
      <div class="cards">
        <For each={props.alerts}>
          {(alert) => <AlertCard alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
        </For>
      </div>
    }
  >
    <ul class="alert-rows">
      <For each={[...props.alerts].sort(worstFirst)}>
        {(alert) => <AlertRow alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
      </For>
    </ul>
  </Show>
)
