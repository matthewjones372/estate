/** @jsxImportSource solid-js */
/** What happened to a firing, in order: each event with its date and time to the second, who did it, and what. */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { FiringEvent } from "../../shared/timeline"
import { useEstate, useSnapshot } from "../context"
import { instant } from "../format"
import { Out } from "./A"
import { NoteText } from "./NoteText"

/** What an event says in a line: what was done, then what it said. */
const said = (event: FiringEvent): string => {
  switch (event.kind) {
    case "fired":
      return `fired: ${event.text}`
    case "resolved":
      return `resolved ${event.text}`
    case "noted":
      return `noted: ${event.text}`
    case "note-removed":
      return `removed ${event.text}`
    case "silenced":
      return `silenced ${event.text}`
    case "unsilenced":
      return event.text
    case "impact-written":
      return `wrote the impact: ${event.text}`
    case "team-told":
      return event.text
    case "ai-asked":
      return `asked AI (${event.text})`
    case "ai-answered":
      return `AI answered: ${event.text}`
    case "ai-failed":
      return `AI could not answer: ${event.text}`
    case "ai-kept":
      return `kept the AI's answer as a note: ${event.text}`
  }
}

/** UTC, as a review that crosses zones reads it: "2026-10-02 09:00:00 UTC". */
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`

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
              <For each={read() as ReadonlyArray<FiringEvent>}>
                {(event) => (
                  <li>
                    <time class="mono" datetime={event.at} title={utc(event.at)}>
                      {instant(event.at)}
                    </time>{" "}
                    <strong class="timeline-who">{event.by}</strong>{" "}
                    <Show when={event.link} fallback={<NoteText text={said(event)} />}>
                      {(link) => <Out href={link()}>{said(event)}</Out>}
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        )}
      </Show>
    </Show>
  )
}
