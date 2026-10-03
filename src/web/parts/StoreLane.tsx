/** @jsxImportSource solid-js */
/** A store's lane on the overview: its health and why, its stats over the last hour, and its links. */
import { For } from "solid-js"
import type { CatalogEvent, ServicesEvent } from "../../shared/events"
import { A } from "./A"
import { HealthLine, Links } from "./Lane"
import { Spark } from "./Sparkline"

export type DescribedStore = NonNullable<CatalogEvent["stores"]>[number]
export type StoreState = NonNullable<ServicesEvent["stores"]>[number]

export const StoreLane = (props: { readonly store: DescribedStore; readonly state: StoreState | undefined }) => (
  <article class={`lane store-lane ${props.state?.health ?? "unknown"}`}>
    <div class="lane-name">
      <A to={`/stores/${encodeURIComponent(props.store.name)}`} class="lane-title">
        {props.store.name}
      </A>
      <HealthLine state={props.state} />
      <span class="muted mono" style={{ "font-size": "12px" }}>
        {props.store.engine}
      </span>
    </div>
    <div class="sparks">
      <For each={(props.state?.stats ?? []).slice(0, 4)}>
        {(stat) => <Spark label={stat.title} unit={stat.unit ?? ""} series={stat.series} />}
      </For>
    </div>
    <Links service={props.store} />
  </article>
)
