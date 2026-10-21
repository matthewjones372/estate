/** @jsxImportSource solid-js */
/**
 * The estate drawn live: its services and stores, and the traffic between them; amber is what needs someone. Past a
 * dozen nodes, a node a category, which opens in place. A large map or a narrow screen starts as areas (spec 0062).
 */
import { createMemo, createSignal, For, Show } from "solid-js"
import type { CatalogEvent, ServicesEvent } from "../../shared/events"
import { healthOf, largeMap, pathOf, subOf } from "../areas"
import { type DrawnCategory, type DrawnEdge, type DrawnNode, drawnOf } from "../drawn"
import { amount, took } from "../format"
import { byName } from "../indexed"
import { kept } from "../kept"
import { layout } from "../layout"
import { A } from "./A"
import { MapAreas } from "./MapAreas"
import { JourneyChoices, journeyOnMap, RouteLines, RouteNote } from "./MapJourney"

type MapNode = CatalogEvent["map"]["nodes"][number]

/** Room a node needs: a row's height and a column's width, in pixels. */
const rowHeight = 60
const columnWidth = 170

const opening = kept("estate.map.opened")
const openedAtFirst = (): ReadonlySet<string> => new Set((opening.read() ?? "").split("\n").filter(Boolean))

interface Shape {
  readonly ids: ReadonlyArray<string>
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>
}

const sameShape = (was: Shape, now: Shape) =>
  was.ids.length === now.ids.length &&
  was.edges.length === now.edges.length &&
  was.ids.every((id, index) => now.ids[index] === id) &&
  was.edges.every((edge, index) => now.edges[index]?.from === edge.from && now.edges[index]?.to === edge.to)

type View = "areas" | "lines"
const viewing = kept("estate.map.view")
const narrow = () => typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches
const viewAtFirst = (catalog: CatalogEvent): View => {
  const chosen = viewing.read()
  if (chosen === "areas" || chosen === "lines") return chosen
  return largeMap(catalog) || narrow() ? "areas" : "lines"
}

const isCategory = (node: DrawnNode): node is DrawnCategory => "kind" in node && node.kind === "category"

export const EstateMap = (props: { readonly catalog: CatalogEvent; readonly services: ServicesEvent | undefined }) => {
  const [view, setView] = createSignal(viewAtFirst(props.catalog))
  const choose = (next: View) => {
    setView(next)
    viewing.write(next)
  }
  const [opened, setOpened] = createSignal(openedAtFirst())
  const toggle = (category: string) => {
    const next = new Set(opened())
    if (next.has(category)) next.delete(category)
    else next.add(category)
    setOpened(next)
    opening.write([...next].join("\n"))
  }
  const on = journeyOnMap(() => props.catalog)
  const drawn = createMemo(() => drawnOf(props.catalog, props.services, opened(), props.catalog.map.collapse))
  // Laid out again only when the nodes or the lines between them change, not each time one changes its health.
  const shape = createMemo(
    () => ({ ids: drawn().nodes.map((node) => node.id), edges: drawn().edges.map(({ from, to }) => ({ from, to })) }),
    undefined,
    { equals: sameShape },
  )
  const placed = createMemo(() => layout(shape().ids, shape().edges))
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
        const dead = () => line.edge.dead
        const hot = () => !dead() && line.edge.alerting
        return (
          <g>
            <line
              x1={at().from.x}
              y1={at().from.y}
              x2={at().to.x}
              y2={at().to.y}
              stroke={dead() ? "#5A1F22" : hot() ? "#4A3510" : "#232836"}
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
            <line
              class={dead() ? "dead" : "flow"}
              x1={at().from.x}
              y1={at().from.y}
              x2={at().to.x}
              y2={at().to.y}
              stroke={dead() ? "#A84848" : hot() ? "#F5A524" : "#5F6B85"}
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
            <span class={`dot small-dot ${shown.node.health} ${hotOf(shown.node.health)}`} />
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
    const health = () => healthOf(shown.node, state(), store())
    const to = () => pathOf(shown.node)
    const steps = () => on.stepsAt(shown.node.id)
    const here = () => on.hereAt(shown.node.id)
    const sub = () => {
      const spent = here()
      return spent === undefined ? subOf(shown.node, state(), store()) : `${took(spent)} here`
    }
    const routed = () => (on.journey() === undefined ? "" : steps().length > 0 ? " map-on-route" : " map-off-route")
    const body = () => (
      <>
        <Show when={steps().length > 0}>
          <span class="map-step mono" aria-hidden="true">
            {steps().join(" · ")}
          </span>
          <span class="visually-hidden">
            Step {steps().join(" and ")} of {on.journey()?.title}:{" "}
          </span>
        </Show>
        <span class="map-node-name">
          <span class={`dot small-dot ${health()} ${hotOf(health())}`} />
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
              <span class={`map-node ${health()}${routed()}`} style={{ left: `${at().x}%`, top: `${at().y}%` }}>
                {body()}
              </span>
            }
          >
            {(path) => (
              <A
                to={path()}
                class={`map-node ${health()}${routed()}`}
                style={{ left: `${at().x}%`, top: `${at().y}%` }}
              >
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
      <figure
        aria-labelledby="map-title"
        class="panel map"
        classList={{ "map-journeying": on.journey() !== undefined }}
      >
        <figcaption class="spread">
          <span id="map-title" class="strong">
            The estate, live
          </span>
          <span class="map-opened">
            <fieldset class="choices bare">
              <legend class="visually-hidden">Draw the estate as</legend>
              <button type="button" class="choice" aria-pressed={view() === "areas"} onClick={() => choose("areas")}>
                Areas
              </button>
              <button type="button" class="choice" aria-pressed={view() === "lines"} onClick={() => choose("lines")}>
                Lines
              </button>
            </fieldset>
            <Show when={view() === "lines"}>
              <JourneyChoices on={on} />
              <For each={drawn().opened}>
                {(category) => (
                  <button type="button" class="plain-button" aria-expanded="true" onClick={() => toggle(category)}>
                    Close {category}
                  </button>
                )}
              </For>
            </Show>
            <span class="muted small">Traffic over the last minute · amber is what needs you</span>
          </span>
        </figcaption>
        <Show when={view() === "areas"}>
          <MapAreas catalog={props.catalog} services={props.services} />
        </Show>
        <Show when={view() === "lines"}>
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
                <RouteLines journey={on.journey()} at={(node) => placed().at.get(node)} />
              </svg>
              <For each={drawn().edges}>{(edge) => <Label edge={edge} />}</For>
              <For each={drawn().nodes}>
                {(node) => (isCategory(node) ? <Category node={node} /> : <Node node={node} />)}
              </For>
            </div>
          </div>
          <RouteNote on={on} />
        </Show>
      </figure>
    </Show>
  )
}
