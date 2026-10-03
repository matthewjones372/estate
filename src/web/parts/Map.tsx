/** @jsxImportSource solid-js */
/** The estate drawn live: its services and stores, and the traffic between them; amber is what needs someone. */
import { createMemo, For, Show } from "solid-js"
import type { CatalogEvent, ServicesEvent } from "../../shared/events"
import { amount } from "../format"
import { byName, indexed } from "../indexed"
import { layout } from "../layout"
import { A } from "./A"

type MapNode = CatalogEvent["map"]["nodes"][number]
type MapEdge = CatalogEvent["map"]["edges"][number]

export const EstateMap = (props: { readonly catalog: CatalogEvent; readonly services: ServicesEvent | undefined }) => {
  const placed = createMemo(() =>
    layout(
      props.catalog.map.nodes.map((node) => node.id),
      props.catalog.map.edges,
    ),
  )
  const flows = indexed(
    () => props.services?.edges,
    (edge) => `${edge.from}\u0000${edge.to}`,
  )
  const states = byName(() => props.services?.services)
  const storeStates = byName(() => props.services?.stores)
  const flow = (edge: MapEdge) => flows().get(`${edge.from}\u0000${edge.to}`)
  const stateOf = (service: string | undefined) => (service === undefined ? undefined : states().get(service))
  const storeStateOf = (store: string | undefined) => (store === undefined ? undefined : storeStates().get(store))
  const ends = (edge: MapEdge) => {
    const from = placed().get(edge.from)
    const to = placed().get(edge.to)
    return from === undefined || to === undefined ? undefined : { from, to }
  }

  const Line = (line: { readonly edge: MapEdge }) => (
    <Show when={ends(line.edge)}>
      {(at) => {
        const hot = () => flow(line.edge)?.alerting === true
        return (
          <g>
            <line
              x1={at().from.x}
              y1={at().from.y}
              x2={at().to.x}
              y2={at().to.y}
              stroke={hot() ? "#4A3510" : "#232836"}
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <line
              class="flow"
              x1={at().from.x}
              y1={at().from.y}
              x2={at().to.x}
              y2={at().to.y}
              stroke={hot() ? "#F5A524" : "#5F6B85"}
              stroke-width={hot() ? 2.5 : 1.5}
              stroke-linecap="round"
              vector-effect="non-scaling-stroke"
            />
          </g>
        )
      }}
    </Show>
  )

  const Label = (label: { readonly edge: MapEdge }) => {
    const text = () => {
      const rate = flow(label.edge)?.rate
      return [label.edge.label, rate === null || rate === undefined ? undefined : `${amount(rate)}/s`]
        .filter(Boolean)
        .join(" ")
    }
    return (
      <Show when={text() !== "" ? ends(label.edge) : undefined}>
        {(at) => (
          <span
            class={`map-label mono ${flow(label.edge)?.alerting ? "hot" : ""}`}
            style={{ left: `${(at().from.x + at().to.x) / 2}%`, top: `${(at().from.y + at().to.y) / 2}%` }}
          >
            {text()}
          </span>
        )}
      </Show>
    )
  }

  const Node = (shown: { readonly node: MapNode }) => {
    const state = () => stateOf(shown.node.service)
    const store = () => storeStateOf(shown.node.store)
    const health = () =>
      shown.node.service !== undefined
        ? (state()?.health ?? "unknown")
        : shown.node.store !== undefined
          ? (store()?.health ?? "unknown")
          : "healthy"
    const to = () =>
      shown.node.service !== undefined
        ? `/services/${encodeURIComponent(shown.node.service)}`
        : shown.node.store === undefined
          ? undefined
          : `/stores/${encodeURIComponent(shown.node.store)}`
    const sub = () => {
      const requests = state()?.load.requests?.now
      if (shown.node.store !== undefined) return store()?.reasons[0] ?? shown.node.kind
      if (shown.node.service === undefined) return shown.node.kind
      return requests === undefined || requests === null ? (state()?.version ?? "") : `${amount(requests)} req/s`
    }
    const body = () => (
      <>
        <span class="map-node-name">
          <span
            class={`dot ${health()} ${health() === "attention" || health() === "critical" ? "hot" : ""}`}
            style={{ width: "7px", height: "7px" }}
          />
          {shown.node.title}
        </span>
        <span class="mono map-node-sub">{sub()}</span>
      </>
    )
    return (
      <Show when={placed().get(shown.node.id)}>
        {(at) => (
          <Show
            when={to()}
            fallback={
              <span class={`map-node ${health()}`} style={{ left: `${at().x}%`, top: `${at().y}%` }}>
                {body()}
              </span>
            }
          >
            {(path) => (
              <A to={path()} class={`map-node ${health()}`} style={{ left: `${at().x}%`, top: `${at().y}%` }}>
                {body()}
              </A>
            )}
          </Show>
        )}
      </Show>
    )
  }

  return (
    <Show when={props.catalog.map.nodes.length > 0}>
      <figure aria-labelledby="map-title" class="panel map">
        <figcaption class="spread">
          <span id="map-title" style={{ "font-weight": 600 }}>
            The estate, live
          </span>
          <span class="muted" style={{ "font-size": "12px" }}>
            Traffic over the last minute · amber is what needs you
          </span>
        </figcaption>
        <div class="map-scroll">
          <div class="map-canvas">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" class="map-lines">
              <For each={props.catalog.map.edges}>{(edge) => <Line edge={edge} />}</For>
            </svg>
            <For each={props.catalog.map.edges}>{(edge) => <Label edge={edge} />}</For>
            <For each={props.catalog.map.nodes}>{(node) => <Node node={node} />}</For>
          </div>
        </div>
      </figure>
    </Show>
  )
}
