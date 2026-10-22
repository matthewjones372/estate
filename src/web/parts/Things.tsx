/** @jsxImportSource solid-js */
/**
 * What needs you, a row a thing (spec 0068): its number, kind, title, one line, owners and age. An incident's row
 * opens to its alerts' rows, an alert's to its card, in place.
 */
import { For, Index, Show } from "solid-js"
import type { CatalogEvent } from "../../shared/events"
import { useEstate } from "../context"
import { cardFold } from "../fold"
import { counted, since } from "../format"
import { kindWords, type Thing } from "../needs"
import { A } from "./A"
import { AlertCard } from "./AlertCard"
import { AlertRow } from "./AlertRows"

interface Shown {
  readonly catalog: CatalogEvent | undefined
  readonly canSilence: boolean
}

const ThingRow = (props: Shown & { readonly thing: Thing; readonly number: number }) => {
  const { actions, now } = useEstate()
  // Looked up by where it opens, so a row that moves up the list keeps what it had open.
  const fold = () => cardFold(actions, `${props.thing.to} thing`)
  const open = () => fold()[0]()
  const setOpen = (next: boolean) => fold()[1](next)
  const held = () => `held-${props.thing.to.replace(/[^\w-]/g, "-")}`
  const alerts = () => props.thing.alerts
  const one = () => (props.thing.kind === "alert" ? alerts()[0] : undefined)
  let toggle: HTMLButtonElement | undefined
  const close = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    setOpen(false)
    toggle?.focus()
  }
  return (
    <li class={`thing ${props.thing.tone}`}>
      <div class="thing-line">
        <span class="thing-number mono" aria-hidden="true">
          {props.number}
        </span>
        <span class={`thing-kind ${props.thing.tone}`}>
          <span class={`dot ${props.thing.tone}`} />
          {kindWords[props.thing.kind]}
        </span>
        <span class="thing-main">
          <A to={props.thing.to} class="thing-title">
            {props.thing.title}
          </A>
          <span class="thing-what">{props.thing.what}</span>
        </span>
        <span class="thing-owners">{props.thing.owners.join(", ")}</span>
        <span class="thing-age mono">{props.thing.since === undefined ? "" : since(props.thing.since, now())}</span>
        <Show when={alerts().length > 0}>
          <button
            type="button"
            ref={toggle}
            class="row-toggle"
            aria-expanded={open()}
            aria-controls={held()}
            onClick={() => setOpen(!open())}
          >
            <span class="visually-hidden">
              {open() ? "Close" : "Open"}{" "}
              {one() === undefined ? `${props.thing.title}'s alerts` : `${one()?.name}'s card`}
            </span>
          </button>
        </Show>
      </div>
      <Show when={open()}>
        <Show
          when={one()}
          fallback={
            <ul id={held()} class="alert-rows nested">
              <For each={alerts()}>
                {(alert) => <AlertRow alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
              </For>
            </ul>
          }
        >
          {(alert) => (
            <section id={held()} class="row-card" aria-label={`${alert().name}'s card`} onKeyDown={close}>
              <AlertCard alert={alert()} catalog={props.catalog} canSilence={props.canSilence} />
            </section>
          )}
        </Show>
      </Show>
    </li>
  )
}

export const Things = (props: Shown & { readonly things: ReadonlyArray<Thing> }) => (
  <section aria-labelledby="needs" class="stack">
    <div class="spread">
      <h2 id="needs" class="needs-title">
        {props.things.length === 0
          ? "Nothing needs you"
          : `${counted(props.things.length, "thing")} ${props.things.length === 1 ? "needs" : "need"} you`}
      </h2>
      <A to="/alerts">All alerts →</A>
    </div>
    <Show
      when={props.things.length > 0}
      fallback={<p class="muted flush">Nothing. When something does, it appears here first.</p>}
    >
      <ol class="things">
        <Index each={props.things}>
          {(thing, index) => (
            <ThingRow thing={thing()} number={index + 1} catalog={props.catalog} canSilence={props.canSilence} />
          )}
        </Index>
      </ol>
    </Show>
  </section>
)
