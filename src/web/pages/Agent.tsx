/** @jsxImportSource solid-js */
/** An AI agent at its own address: what its overview lane already shows, with runs on demand. */
import { Show } from "solid-js"
import { useSnapshot } from "../context"
import { A } from "../parts/A"
import { AgentLane } from "../parts/AgentLane"

export const AgentPage = (props: { readonly name: string }) => {
  const snapshot = useSnapshot()
  const agent = () => snapshot.events.catalog?.agents?.find((each) => each.name === props.name)
  const state = () => snapshot.events.services?.agents?.find((each) => each.name === props.name)
  return (
    <Show
      when={snapshot.events.catalog === undefined || agent() !== undefined}
      fallback={
        <main class="state-page">
          <h1>There is no such page.</h1>
          <A to="/">The overview</A>
        </main>
      }
    >
      <main class="main">
        <section aria-label={props.name} class="stack">
          <nav aria-label="Breadcrumb" class="muted crumbs">
            <A to="/">Overview</A> / {props.name}
          </nav>
          <Show when={agent()}>{(described) => <AgentLane agent={described()} state={state()} />}</Show>
        </section>
      </main>
    </Show>
  )
}
