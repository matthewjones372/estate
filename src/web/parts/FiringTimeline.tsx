/** @jsxImportSource solid-js */
/** What happened to a firing, in order: each event with its date and time to the second, who did it, and what. */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { FiringEvent } from "../../shared/timeline"
import { useEstate, useSnapshot } from "../context"
import { TimelineRow } from "./TimelineRow"

/** `refresh` is anything that changes when the firing does, so a live firing's timeline follows what people do. */
export const FiringTimeline = (props: {
  readonly alert: string
  readonly startsAt: string
  readonly refresh?: unknown
}) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [events, setEvents] = createSignal<ReadonlyArray<FiringEvent> | "unread" | undefined>("unread")
  createEffect(
    on([() => props.alert, () => props.startsAt, () => snapshot.environment, () => props.refresh], ([alert, at]) => {
      let current = true
      void actions.events(alert, at).then((found) => {
        if (current) setEvents(found)
      })
      onCleanup(() => {
        current = false
      })
    }),
  )
  return (
    <Show when={events() !== "unread"}>
      <Show
        when={events()}
        fallback={
          <p class="muted" style={{ margin: 0 }}>
            The timeline could not be read.
          </p>
        }
      >
        {(read) => (
          <Show
            when={(read() as ReadonlyArray<FiringEvent>).length > 0}
            fallback={
              <p class="muted" style={{ margin: 0 }}>
                Nothing is kept for this firing yet.
              </p>
            }
          >
            <ol class="timeline">
              <For each={read() as ReadonlyArray<FiringEvent>}>{(event) => <TimelineRow event={event} />}</For>
            </ol>
          </Show>
        )}
      </Show>
    </Show>
  )
}
