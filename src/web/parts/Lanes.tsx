/** @jsxImportSource solid-js */
/** The overview's lanes: a lane per service and per store, under a heading per category when the catalog names any. */
import { For, Show } from "solid-js"
import { useSnapshot } from "../context"
import { groupsOf } from "../groups"
import { byName } from "../indexed"
import { Lane } from "./Lane"
import { StoreLane } from "./StoreLane"

export const Lanes = () => {
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const states = byName(() => events().services?.services)
  const storeStates = byName(() => events().services?.stores)
  const deployed = byName(() => events().deploys?.services)
  const groups = () => groupsOf(events().catalog)
  const grouped = () => groups()[0]?.title !== undefined
  return (
    <section
      class="services"
      aria-labelledby={grouped() ? undefined : "services-title"}
      aria-label={grouped() ? "The estate by area" : undefined}
    >
      <For each={groups()}>
        {(group, index) => (
          <section aria-label={group.title} class="lanes-group">
            <div class="spread">
              <h2 id={index() === 0 ? "services-title" : undefined} class="section-title">
                {group.title ?? "Services"}
              </h2>
              <Show when={index() === 0}>
                <span class="muted" style={{ "font-size": "12px" }}>
                  Last hour · pipeline: commit, build, chosen, running
                </span>
              </Show>
            </div>
            <For each={group.services}>
              {(service) => (
                <Lane
                  service={service}
                  state={states().get(service.name)}
                  deployed={deployed().get(service.name)}
                  environment={snapshot.environment}
                />
              )}
            </For>
            <Show when={group.title === undefined && group.stores.length > 0}>
              <div class="spread">
                <h2 id="stores-title" class="section-title">
                  Stores
                </h2>
                <span class="muted" style={{ "font-size": "12px" }}>
                  Last hour
                </span>
              </div>
            </Show>
            <For each={group.stores}>
              {(store) => <StoreLane store={store} state={storeStates().get(store.name)} />}
            </For>
          </section>
        )}
      </For>
    </section>
  )
}
