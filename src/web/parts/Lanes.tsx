/** @jsxImportSource solid-js */
/** The overview's services as lanes (list) or a denser grid; stores, jobs and agents stay as lanes. */
import { createSignal, For, Show } from "solid-js"
import { useSnapshot } from "../context"
import { groupsOf } from "../groups"
import { byName } from "../indexed"
import { kept } from "../kept"
import { AgentLane } from "./AgentLane"
import { JobLane } from "./JobLane"
import { Lane } from "./Lane"
import { ServiceGrid } from "./ServiceGrid"
import { StoreLane } from "./StoreLane"

const preference = kept("estate.services.layout")
type Layout = "list" | "grid"
const initial = (): Layout => (preference.read() === "grid" ? "grid" : "list")

export const Lanes = () => {
  const snapshot = useSnapshot()
  const [layout, setLayout] = createSignal<Layout>(initial())
  const choose = (next: Layout) => {
    setLayout(next)
    preference.write(next)
  }
  const events = () => snapshot.events
  const states = byName(() => events().services?.services)
  const storeStates = byName(() => events().services?.stores)
  const jobStates = byName(() => events().services?.jobs)
  const agentStates = byName(() => events().services?.agents)
  const deployed = byName(() => events().deploys?.services)
  const alerts = () => events().alerts?.alerts ?? []
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
                <fieldset class="choices bare services-layout">
                  <legend class="visually-hidden">Services layout</legend>
                  <button
                    type="button"
                    class="choice"
                    aria-pressed={layout() === "list"}
                    onClick={() => choose("list")}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    class="choice"
                    aria-pressed={layout() === "grid"}
                    onClick={() => choose("grid")}
                  >
                    Grid
                  </button>
                </fieldset>
              </Show>
            </div>
            <Show
              when={layout() === "grid"}
              fallback={
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
              }
            >
              <ServiceGrid
                services={group.services}
                states={states()}
                deployed={deployed()}
                alerts={alerts()}
                environment={snapshot.environment}
              />
            </Show>
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
            <Show when={group.title === undefined && group.jobs.length > 0}>
              <h2 class="section-title">Jobs</h2>
            </Show>
            <For each={group.jobs}>{(job) => <JobLane job={job} state={jobStates().get(job.name)} />}</For>
            <Show when={group.title === undefined && group.agents.length > 0}>
              <h2 class="section-title">Agents</h2>
            </Show>
            <For each={group.agents}>
              {(agent) => <AgentLane agent={agent} state={agentStates().get(agent.name)} />}
            </For>
          </section>
        )}
      </For>
    </section>
  )
}
