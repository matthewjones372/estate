/** @jsxImportSource solid-js */
/** A job no service owns, at its own address: what its overview lane already shows. */
import { Show } from "solid-js"
import { useSnapshot } from "../context"
import { A } from "../parts/A"
import { JobLane } from "../parts/JobLane"

export const JobPage = (props: { readonly name: string }) => {
  const snapshot = useSnapshot()
  const job = () => snapshot.events.catalog?.jobs?.find((each) => each.name === props.name)
  const state = () => snapshot.events.services?.jobs?.find((each) => each.name === props.name)
  return (
    <Show
      when={snapshot.events.catalog === undefined || job() !== undefined}
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
          <Show when={job()}>{(described) => <JobLane job={described()} state={state()} />}</Show>
        </section>
      </main>
    </Show>
  )
}
