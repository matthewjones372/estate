/** What changed today, newest first. */
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
}

export const Feed = (props: { readonly feed: FeedEvent | undefined }) => {
  const items = props.feed?.items ?? []
  return (
    <aside aria-labelledby="changes" className="panel feed">
      <div className="spread">
        <h2 id="changes" className="section-title">
          What changed today
        </h2>
        <A to="/deploys">Deploys</A>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Nothing yet today.
        </p>
      ) : (
        <ol>
          {items.map((item) => (
            <li key={`${item.at}-${item.kind}-${item.text}`}>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {clock(item.at)}
              </span>
              <span className="dot" style={{ background: dots[item.kind] }} />
              <span style={{ fontSize: 13, color: "#D5DAE3" }}>
                {item.who === undefined ? "" : `${item.who}: `}
                {item.service === undefined ? "" : `${item.service} `}
                {item.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
