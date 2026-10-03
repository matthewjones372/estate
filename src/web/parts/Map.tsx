/** @jsxImportSource solid-js */
/**
 * The estate drawn live: its services and stores, and the traffic between them; amber is what needs someone. Past a
 * dozen nodes, a node a category, which opens in place.
 */
import { createMemo, createSignal, For, Show } from "solid-js"
import type { CatalogEvent, ServicesEvent } from "../../shared/events"
import { type DrawnCategory, type DrawnEdge, type DrawnNode, drawnOf } from "../drawn"
import { amount } from "../format"
import { byName } from "../indexed"
import { kept } from "../kept"
import { layout } from "../layout"
import { A } from "./A"

type MapNode = CatalogEvent["map"]["nodes"][number]

/** Room a node needs: a row's height and a column's width, in pixels. */
const rowHeight = 60
const columnWidth = 170

const opening = kept("estate.map.opened")
const openedAtFirst = (): ReadonlySet<string> => new Set((opening.read() ?? "").split("\n").filter(Boolean))

const isCategory = (node: DrawnNode): node is DrawnCategory => "kind" in node && node.kind === "category"

export const EstateMap = (props: { readonly catalog: CatalogEvent; readonly services: ServicesEvent | undefined }) => {
  const [opened, setOpened] = createSignal(openedAtFirst())
  const toggle = (category: string) => {
    const next = new Set(opened())
    if (next.has(category)) next.delete(category)
    else next.add(category)
    setOpened(next)
    opening.write([...next].join("\n"))
  }
  const drawn = createMemo(() => drawnOf(props.catalog, props.services, opened(), props.catalog.map.collapse))
  const placed = createMemo(() =>
    layout(
      drawn().nodes.map((node) => node.id),
      drawn().edges,
    ),
  )
  const states = byName(() => props.services?.services)
  const storeStates = byName(() => props.services?.stores)
  const stateOf = (service: string | undefined) => (service === undefined ? undefined : states().get(service))
  const storeStateOf = (store: string | undefined) => (store === undefined ? undefined : storeStates().get(store))
  const ends = (edge: DrawnEdge) => {
    const from = placed().at.get(edge.from)
    const to = placed().at.get(edge.to)
    return from === undefined || to === undefined ? undefined : { from, to }
  }

  const Line = (line: { readonly edge: DrawnEdge }) => (
    <Show when={ends(line.edge)}>
      {(at) => {
        const hot = () => line.edge.alerting
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

  const Label = (label: { readonly edge: DrawnEdge }) => {
    const text = () =>
      [label.edge.label, label.edge.rate === null ? undefined : `${amount(label.edge.rate)}/s`]
        .filter(Boolean)
        .join(" ")
    return (
      <Show when={text() !== "" ? ends(label.edge) : undefined}>
        {(at) => (
          <span
            class={`map-label mono ${label.edge.alerting ? "hot" : ""}`}
            style={{ left: `${(at().from.x + at().to.x) / 2}%`, top: `${(at().from.y + at().to.y) / 2}%` }}
          >
            {text()}
          </span>
        )}
      </Show>
    )
  }

  const hotOf = (health: string) => (health === "attention" || health === "critical" ? "hot" : "")

  const Category = (shown: { readonly node: DrawnCategory }) => (
    <Show when={placed().at.get(shown.node.id)}>
      {(at) => (
        <button
          type="button"
          class={`map-node map-category ${shown.node.health}`}
          style={{ left: `${at().x}%`, top: `${at().y}%` }}
          aria-expanded="false"
          onClick={() => toggle(shown.node.title)}
        >
          <span class="map-node-name">
            <span
              class={`dot ${shown.node.health} ${hotOf(shown.node.health)}`}
              style={{ width: "7px", height: "7px" }}
            />
            {shown.node.title}
          </span>
          <span class="mono map-node-sub">
            {shown.node.beside === 0
              ? `${shown.node.members} node${shown.node.members === 1 ? "" : "s"}`
              : `${shown.node.members} more`}
          </span>
        </button>
      )}
    </Show>
  )

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
          <span class={`dot ${health()} ${hotOf(health())}`} style={{ width: "7px", height: "7px" }} />
          {shown.node.title}
        </span>
        <span class="mono map-node-sub">{sub()}</span>
      </>
    )
    return (
      <Show when={placed().at.get(shown.node.id)}>
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
          <span class="map-opened">
            <For each={drawn().opened}>
              {(category) => (
                <button type="button" class="plain-button" aria-expanded="true" onClick={() => toggle(category)}>
                  Close {category}
                </button>
              )}
            </For>
            <span class="muted" style={{ "font-size": "12px" }}>
              Traffic over the last minute · amber is what needs you
            </span>
          </span>
        </figcaption>
        <div class="map-scroll">
          <div
            class="map-canvas"
            style={{
              height: `${Math.max(380, placed().rows * rowHeight + 20)}px`,
              "min-width": `${Math.max(720, placed().columns * columnWidth)}px`,
            }}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" class="map-lines">
              <For each={drawn().edges}>{(edge) => <Line edge={edge} />}</For>
            </svg>
            <For each={drawn().edges}>{(edge) => <Label edge={edge} />}</For>
            <For each={drawn().nodes}>
              {(node) => (isCategory(node) ? <Category node={node} /> : <Node node={node} />)}
            </For>
          </div>
        </div>
      </figure>
    </Show>
  )
}
