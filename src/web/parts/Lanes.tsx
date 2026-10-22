/** @jsxImportSource solid-js */
/**
 * The overview's services by area, the areas that need someone first (spec 0068). In each, what is not healthy has
 * its lane, and the healthy services and stores are one line of links until opened; or every service in a grid.
 * Jobs and agents keep their lanes, for their schedules and budgets.
 */
import { createSignal, For, type JSX, Show } from "solid-js"
import type { Health } from "../../shared/events"
import { useSnapshot } from "../context"
import { type Group, groupsOf, needingFirst, otherwise } from "../groups"
import { byName } from "../indexed"
import { pathOf } from "../route"
import type { Choice, ServicesLayout } from "../view-choices"
import { A } from "./A"
import { AgentLane } from "./AgentLane"
import { JobLane } from "./JobLane"
import { Lane } from "./Lane"
import { ServiceGrid } from "./ServiceGrid"
import { StoreLane } from "./StoreLane"

export const Lanes = (props: { readonly layout: Choice<ServicesLayout>; readonly menu: JSX.Element }) => {
  const snapshot = useSnapshot()
  const events = () => snapshot.events
  const states = byName(() => events().services?.services)
  const storeStates = byName(() => events().services?.stores)
  const jobStates = byName(() => events().services?.jobs)
  const agentStates = byName(() => events().services?.agents)
  const deployed = byName(() => events().deploys?.services)
  const alerts = () => events().alerts?.alerts ?? []
  const healthOf = (name: string): Health | undefined =>
    (states().get(name) ?? storeStates().get(name) ?? jobStates().get(name) ?? agentStates().get(name))?.health
  const groups = () => needingFirst(groupsOf(events().catalog), healthOf)
  const grouped = () => groups()[0]?.title !== undefined
  const [shown, setShown] = createSignal<ReadonlySet<string>>(new Set())
  const showing = (group: Group) => shown().has(group.title ?? otherwise)
  const toggle = (group: Group) => {
    const next = new Set(shown())
    const key = group.title ?? otherwise
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setShown(next)
  }
  const well = (name: string) => healthOf(name) === "healthy"
  return (
    <section
      class="services"
      aria-labelledby={grouped() ? undefined : "services-title"}
      aria-label={grouped() ? "The estate by area" : undefined}
    >
      <For each={groups()}>
        {(group, index) => {
          const healthy = () =>
            props.layout.chosen() === "grid"
              ? group.stores.filter((store) => well(store.name))
              : [
                  ...group.services.filter((service) => well(service.name)),
                  ...group.stores.filter((store) => well(store.name)),
                ]
          const folded = () => !showing(group) && healthy().length > 0
          const laned = <T extends { readonly name: string }>(entries: ReadonlyArray<T>) =>
            folded() ? entries.filter((entry) => !well(entry.name)) : entries
          return (
            <section aria-label={group.title} class="lanes-group">
              <div class="spread">
                <h2 id={index() === 0 ? "services-title" : undefined} class="section-title">
                  {group.title ?? "Services"}
                </h2>
                <Show when={index() === 0}>{props.menu}</Show>
              </div>
              <Show
                when={props.layout.chosen() === "grid"}
                fallback={
                  <For each={laned(group.services)}>
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
              <Show when={group.title === undefined && laned(group.stores).length > 0}>
                <div class="spread">
                  <h2 id="stores-title" class="section-title">
                    Stores
                  </h2>
                  <span class="muted small">Last hour</span>
                </div>
              </Show>
              <For each={laned(group.stores)}>
                {(store) => <StoreLane store={store} state={storeStates().get(store.name)} />}
              </For>
              <Show when={healthy().length > 0}>
                <p class="healthy-line">
                  <span class="healthy-count">
                    <span class="dot healthy" />
                    {healthy().length} healthy{folded() ? ":" : ""}
                  </span>
                  <Show when={folded()}>
                    <For each={healthy()}>
                      {(entry) => (
                        <A
                          to={pathOf(
                            "engine" in entry
                              ? { page: "store", name: entry.name }
                              : { page: "service", name: entry.name },
                          )}
                        >
                          {entry.name}
                        </A>
                      )}
                    </For>
                  </Show>
                  <button type="button" class="plain-button" aria-expanded={!folded()} onClick={() => toggle(group)}>
                    {folded() ? "Show their lanes" : "Fold them to a line"}
                    <span class="visually-hidden"> in {group.title ?? "Services"}</span>
                  </button>
                </p>
              </Show>
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
          )
        }}
      </For>
    </section>
  )
}
