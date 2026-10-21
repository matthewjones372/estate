/** @jsxImportSource solid-js */
/**
 * The estate as areas (spec 0062): a card an area with every part named, what needs someone first, rows of where
 * traffic meets trouble, and a part picked to show what calls it and what it calls.
 */
import { createMemo, createSignal, For, type JSX, Show } from "solid-js"
import type { CatalogEvent, Health, ServicesEvent } from "../../shared/events"
import { type Area, areasOf, type Next, needs, neighboursOf, type Part, troubleOf } from "../areas"
import { amount } from "../format"
import { A } from "./A"

/** Parts an area shows before the healthy rest fold away. */
const shownFirst = 6

const hotOf = (health: Health) => (needs(health) ? "hot" : "")
const rateOf = (rate: number | null) => (rate === null ? "" : `${amount(rate)}/s`)

const Dot = (props: { readonly health: Health }) => (
  <span class={`dot small-dot ${props.health} ${hotOf(props.health)}`} />
)

/** A part as a link to its page, or as it is when it has none. */
const Linked = (props: { readonly part: Part; readonly class: string; readonly children: JSX.Element }) => (
  <Show when={props.part.to} fallback={<span class={props.class}>{props.children}</span>}>
    {(to) => (
      <A to={to()} class={props.class}>
        {props.children}
      </A>
    )}
  </Show>
)

const Step = (props: { readonly part: Part }) => (
  <Linked part={props.part} class={`map-step-part ${props.part.health}`}>
    <Dot health={props.part.health} />
    {props.part.title}
  </Linked>
)

const Arrow = (props: { readonly rate: number | null; readonly hot: boolean }) => (
  <span class={`map-arrow mono ${props.hot ? "map-hot" : ""}`}>
    <svg width="22" height="10" viewBox="0 0 22 10" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M0 5h20M16 1l4 4-4 4" />
    </svg>
    {rateOf(props.rate)}
  </span>
)

const Neighbours = (props: { readonly title: string; readonly near: ReadonlyArray<Next> }) => (
  <Show when={props.near.length > 0}>
    <div class="stack close">
      <span class="muted small">{props.title}</span>
      <ul class="map-near-list">
        <For each={props.near}>
          {(each) => (
            <li>
              <Linked part={each.part} class="map-near-part">
                <Dot health={each.part.health} />
                <span class="map-part-name">{each.part.title}</span>
                <span class="mono small ink-3">{rateOf(each.rate)}</span>
              </Linked>
            </li>
          )}
        </For>
      </ul>
    </div>
  </Show>
)

export const MapAreas = (props: { readonly catalog: CatalogEvent; readonly services: ServicesEvent | undefined }) => {
  const shown = createMemo(() => areasOf(props.catalog, props.services))
  const [picked, setPicked] = createSignal<string | undefined>(undefined)
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string>>(new Set())
  const pickedPart = () => {
    const id = picked()
    return id === undefined ? undefined : shown().parts.get(id)
  }
  const near = createMemo(() => {
    const id = picked()
    return id === undefined ? undefined : neighboursOf(id, shown().parts, shown().edges)
  })
  const nearIds = createMemo(
    () => new Set([...(near()?.callers ?? []), ...(near()?.callees ?? [])].map((each) => each.part.id)),
  )
  const trouble = () => troubleOf(shown().parts, shown().edges)
  const keyOf = (area: Area) => area.title ?? ""
  const visible = (area: Area) => {
    if (unfolded().has(keyOf(area))) return area.parts
    const room = Math.max(shownFirst, area.needing)
    return area.parts.slice(0, room)
  }
  const unfold = (area: Area) => setUnfolded(new Set([...unfolded(), keyOf(area)]))
  const pick = (id: string) => setPicked(picked() === id ? undefined : id)
  return (
    <div class="map-areas-view">
      <Show when={trouble().length > 0}>
        <section aria-labelledby="map-trouble" class="map-trouble">
          <h3 id="map-trouble" class="map-trouble-title">
            Where traffic meets trouble
          </h3>
          <ol class="map-trouble-rows">
            <For each={trouble()}>
              {(row) => (
                <li class="map-trouble-row">
                  <Show when={row.before}>
                    {(before) => (
                      <>
                        <Step part={before().part} />
                        <Arrow rate={before().rate} hot />
                      </>
                    )}
                  </Show>
                  <Step part={row.part} />
                  <Show when={row.after}>
                    {(after) => (
                      <>
                        <Arrow rate={after().rate} hot={false} />
                        <Step part={after().part} />
                      </>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </section>
      </Show>
      <div class="map-areas">
        <For each={shown().areas}>
          {(area) => (
            <section aria-label={area.title ?? "The estate"} class={`map-area ${area.needing > 0 ? "map-hot" : ""}`}>
              <header class="map-area-head">
                <span class="spread">
                  <span class="map-area-title">{area.title ?? "The estate"}</span>
                  <span class="mono small map-area-count">
                    {area.needing > 0
                      ? `${area.needing} of ${area.parts.length} need you`
                      : `${area.parts.length} healthy`}
                  </span>
                </span>
                <span class="map-area-bar" aria-hidden="true">
                  <For each={area.parts}>{(part) => <span class={part.health} />}</For>
                </span>
              </header>
              <div class="map-parts">
                <For each={visible(area)}>
                  {(part) => (
                    <button
                      type="button"
                      class={`map-part ${part.health}`}
                      classList={{ "map-near": nearIds().has(part.id) }}
                      aria-pressed={picked() === part.id}
                      onClick={() => pick(part.id)}
                    >
                      <Dot health={part.health} />
                      <span class="map-part-name">{part.title}</span>
                      <span class="mono map-node-sub">{part.sub}</span>
                    </button>
                  )}
                </For>
              </div>
              <Show when={area.parts.length > visible(area).length}>
                <button type="button" class="plain-button map-more" onClick={() => unfold(area)}>
                  + {area.parts.length - visible(area).length} more, all healthy
                </button>
              </Show>
            </section>
          )}
        </For>
      </div>
      <Show when={pickedPart()}>
        {(part) => (
          <section aria-label={`${part().title} and what it talks to`} class="map-picked">
            <div class="spread">
              <span class="map-picked-name">
                <Dot health={part().health} />
                {part().title}
                <span class="mono small ink-3">{part().sub}</span>
              </span>
              <button type="button" class="plain-button" onClick={() => setPicked(undefined)}>
                Close
              </button>
            </div>
            <div class="map-picked-near">
              <Neighbours title="Called by" near={near()?.callers ?? []} />
              <Neighbours title="Calls" near={near()?.callees ?? []} />
              <Show when={(near()?.callers.length ?? 0) + (near()?.callees.length ?? 0) === 0}>
                <span class="muted small">Nothing on the map calls it or is called by it.</span>
              </Show>
            </div>
            <Show when={part().to}>
              {(to) => (
                <A to={to()} class="map-open">
                  Open {part().title}
                </A>
              )}
            </Show>
          </section>
        )}
      </Show>
    </div>
  )
}
