/** @jsxImportSource solid-js */
/** What changed today, newest first, each change opening what it is about. */
import { For, type JSX, Show } from "solid-js"
import type { FeedEvent, FeedItem } from "../../shared/feed"
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

const text = { "font-size": "13px", color: "#D5DAE3" }

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

export const Feed = (props: { readonly feed: FeedEvent | undefined }) => {
  const items = () => props.feed?.items ?? []
  return (
    <aside aria-labelledby="changes" class="panel feed">
      <div class="spread">
        <h2 id="changes" class="section-title">
          What changed today
        </h2>
        <A to="/deploys">Deploys</A>
      </div>
      <Show
        when={items().length > 0}
        fallback={
          <p class="muted" style={{ margin: 0 }}>
            Nothing yet today.
          </p>
        }
      >
        <ol>
          <For each={items()}>
            {(item) => (
              <li>
                <span class="mono muted" style={{ "font-size": "12px" }}>
                  {clock(item.at)}
                </span>
                <span class="dot" style={{ background: dots[item.kind] }} />
                <Show
                  when={item.kind === "note"}
                  fallback={
                    <Opens item={item}>
                      <FeedText item={item} />
                    </Opens>
                  }
                >
                  <FeedNote item={item} />
                </Show>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </aside>
  )
}
