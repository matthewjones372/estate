/** @jsxImportSource solid-js */
/**
 * What changed today, newest first, each change opening what it is about; builds and versions that went out together
 * as one line that opens to them, and an alert that followed a version saying so (spec 0068).
 */
import { For, type JSX, Show } from "solid-js"
import type { FeedEvent, FeedItem } from "../../shared/feed"
import { batchesOf, type Entry } from "../feed-batches"
import { clock } from "../format"
import { firingPath, pathOf } from "../route"
import { A, Out } from "./A"
import { NoteText } from "./NoteText"

const dots: Readonly<Record<FeedItem["kind"], string>> = {
  alert: "var(--amber)",
  resolved: "var(--waiting)",
  silence: "var(--amber-muted)",
  note: "var(--ink-soft)",
  debug: "var(--debug)",
  deploy: "var(--ink-soft)",
  build: "var(--link)",
  job: "var(--ink-3)",
}

/** Where an item opens: its past firing, its alert, its incident, the agent, job or service, or its build. */
const whereTo = (item: FeedItem): { readonly to: string } | { readonly out: string } | undefined => {
  if (item.firing !== undefined) return { to: firingPath(item.firing.alert, item.firing.startsAt) }
  if (item.incident !== undefined) return { to: pathOf({ page: "incident", id: item.incident.id }) }
  if (item.alert !== undefined) return { to: pathOf({ page: "alert", id: item.alert }) }
  if (item.url !== undefined) return { out: item.url }
  if (item.agent !== undefined) return { to: pathOf({ page: "agent", name: item.agent }) }
  if (item.job !== undefined) return { to: pathOf({ page: "job", name: item.job }) }
  if (item.service !== undefined) return { to: pathOf({ page: "service", name: item.service }) }
  return undefined
}

const Opens = (props: { readonly item: FeedItem; readonly children: JSX.Element }) => (
  <Show when={whereTo(props.item)} fallback={props.children}>
    {(where) => {
      const place = where()
      return "out" in place ? <Out href={place.out}>{props.children}</Out> : <A to={place.to}>{props.children}</A>
    }}
  </Show>
)

const text = { "font-size": "0.8125rem", color: "#D5DAE3" }

const FeedText = (props: { readonly item: FeedItem }) => (
  <span style={text}>
    {props.item.who === undefined ? "" : `${props.item.who}: `}
    {props.item.service === undefined ? "" : `${props.item.service} `}
    {props.item.text}
  </span>
)

/** A note: who wrote it and on what opens that; its text folds beside, its *more* outside the link. */
const FeedNote = (props: { readonly item: FeedItem }) => (
  <span style={text}>
    <Opens item={props.item}>
      {props.item.who === undefined ? "" : `${props.item.who}: `}
      <Show when={props.item.incident?.title ?? props.item.on ?? props.item.alert}>
        {(on) => (
          <>
            on <em>{on()}</em>
          </>
        )}
      </Show>
    </Opens>{" "}
    <NoteText text={props.item.text} />
  </span>
)

const Item = (props: { readonly item: FeedItem; readonly after?: string | undefined }) => (
  <li classList={{ "feed-alert": props.item.kind === "alert" }}>
    <span class="mono muted small">{clock(props.item.at)}</span>
    <span class="dot" style={{ background: dots[props.item.kind] }} />
    <span>
      <Show
        when={props.item.kind === "note"}
        fallback={
          <Opens item={props.item}>
            <FeedText item={props.item} />
          </Opens>
        }
      >
        <FeedNote item={props.item} />
      </Show>
      <Show when={props.after}>{(after) => <span class="feed-sub muted small">{after()}</span>}</Show>
    </span>
  </li>
)

const Batch = (props: { readonly entry: Exclude<Entry, { readonly kind: "item" }> }) => (
  <li>
    <span class="mono muted small">{clock(props.entry.at)}</span>
    <span class="dot" style={{ background: dots[props.entry.kind === "builds" ? "build" : "deploy"] }} />
    <details class="feed-batch">
      <summary>
        <span class="feed-batch-text">{props.entry.text}</span>
        <span class="feed-sub muted small">{props.entry.sub}</span>
      </summary>
      <ul>
        <For each={props.entry.items}>
          {(item) => (
            <li>
              <Opens item={item}>
                <FeedText item={item} />
              </Opens>
            </li>
          )}
        </For>
      </ul>
    </details>
  </li>
)

export const Feed = (props: {
  readonly feed: FeedEvent | undefined
  /** What needs someone, and what is stuck, for which change a batch names first. */
  readonly needing?: ReadonlySet<string>
  readonly stuck?: ReadonlySet<string>
}) => {
  const items = () => props.feed?.items ?? []
  const entries = () => batchesOf(items(), props.needing, props.stuck)
  return (
    <aside aria-labelledby="changes" class="panel feed">
      <div class="spread">
        <h2 id="changes" class="section-title">
          What changed today
        </h2>
        <A to="/deploys">Deploys</A>
      </div>
      <Show when={items().length > 0} fallback={<p class="muted flush">Nothing yet today.</p>}>
        <ol>
          <For each={entries()}>
            {(entry) =>
              entry.kind === "item" ? <Item item={entry.item} after={entry.after} /> : <Batch entry={entry} />
            }
          </For>
        </ol>
      </Show>
    </aside>
  )
}
