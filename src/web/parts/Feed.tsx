/** @jsxImportSource solid-js */
/** What changed today, newest first. */
import { For, Show } from "solid-js"
import type { FeedEvent, FeedItem } from "../../shared/events"
import { clock } from "../format"
import { A } from "./A"

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
                <span style={{ "font-size": "13px", color: "#D5DAE3" }}>
                  {item.who === undefined ? "" : `${item.who}: `}
                  {item.service === undefined ? "" : `${item.service} `}
                  {item.text}
                </span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </aside>
  )
}
