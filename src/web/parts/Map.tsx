/** The estate drawn live: its services and stores, and the traffic between them; amber is what needs someone. */
import type { CatalogEvent, ServicesEvent } from "../../shared/events"
import { amount } from "../format"
import { layout } from "../layout"
import { A } from "./A"

export const EstateMap = (props: { readonly catalog: CatalogEvent; readonly services: ServicesEvent | undefined }) => {
  const { nodes, edges } = props.catalog.map
  if (nodes.length === 0) return null
  const placed = layout(
    nodes.map((node) => node.id),
    edges,
  )
  const rates = new Map((props.services?.edges ?? []).map((edge) => [`${edge.from}>${edge.to}`, edge]))
  const live = edges.map((edge) => rates.get(`${edge.from}>${edge.to}`))
  const stateOf = (service: string | undefined) => props.services?.services.find((each) => each.name === service)
  return (
    <figure aria-labelledby="map-title" className="panel map">
      <figcaption className="spread">
        <span id="map-title" style={{ fontWeight: 600 }}>
          The estate, live
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Traffic over the last minute · amber is what needs you
        </span>
      </figcaption>
      <div className="map-scroll">
        <div className="map-canvas">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="map-lines">
            {edges.map((edge, index) => {
              const from = placed.get(edge.from)
              const to = placed.get(edge.to)
              if (from === undefined || to === undefined) return null
              const hot = live[index]?.alerting === true
              return (
                <g key={`${edge.from}-${edge.to}-${edge.label ?? index}`}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={hot ? "#4A3510" : "#232836"}
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    className="flow"
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={hot ? "#F5A524" : "#5F6B85"}
                    strokeWidth={hot ? 2.5 : 1.5}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )
            })}
          </svg>
          {edges.map((edge, index) => {
            const from = placed.get(edge.from)
            const to = placed.get(edge.to)
            const rate = live[index]?.rate
            const text = [edge.label, rate === null || rate === undefined ? undefined : `${amount(rate)}/s`]
              .filter(Boolean)
              .join(" ")
            if (from === undefined || to === undefined || text === "") return null
            return (
              <span
                key={`label-${edge.from}-${edge.to}-${edge.label ?? ""}`}
                className={`map-label mono ${live[index]?.alerting ? "hot" : ""}`}
                style={{ left: `${(from.x + to.x) / 2}%`, top: `${(from.y + to.y) / 2}%` }}
              >
                {text}
              </span>
            )
          })}
          {nodes.map((node) => {
            const at = placed.get(node.id)
            if (at === undefined) return null
            const state = stateOf(node.service)
            const health = node.service === undefined ? "healthy" : (state?.health ?? "unknown")
            const requests = state?.load.requests?.now
            const sub =
              node.service === undefined
                ? node.kind
                : requests === undefined || requests === null
                  ? (state?.version ?? "")
                  : `${amount(requests)} req/s`
            const body = (
              <>
                <span className="map-node-name">
                  <span
                    className={`dot ${health} ${health === "attention" || health === "critical" ? "hot" : ""}`}
                    style={{ width: 7, height: 7 }}
                  />
                  {node.title}
                </span>
                <span className="mono map-node-sub">{sub}</span>
              </>
            )
            const style = { left: `${at.x}%`, top: `${at.y}%` }
            return node.service === undefined ? (
              <span key={node.id} className={`map-node ${health}`} style={style}>
                {body}
              </span>
            ) : (
              <A
                key={node.id}
                to={`/services/${encodeURIComponent(node.service)}`}
                className={`map-node ${health}`}
                style={style}
              >
                {body}
              </A>
            )
          })}
        </div>
      </div>
    </figure>
  )
}
