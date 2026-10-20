/** @jsxImportSource solid-js */
/** A service's errors over the last day, counted under its health, linking to them in its Logs panel. */
import { createSignal, onCleanup, Show } from "solid-js"
import type { ErrorGroups } from "../../shared/log-events"
import { goTo } from "../address"
import { useEstate } from "../context"
import { pathOf } from "../route"

const again = 5 * 60_000

type Found = ErrorGroups | undefined | "loading"

/** "2,000+ errors": how many, with a + when there were more than were read. */
const many = (count: number, noun: string, more = false) =>
  `${count.toLocaleString("en-GB")}${more ? "+" : ""} ${count === 1 && !more ? noun : `${noun}s`}`

/** The count in words: how many, how many groups, and over what, which for pods is only since they started. */
const said = (found: Found) => {
  if (found === "loading") return "Errors in 24h …"
  if (found === undefined) return "Errors in 24h: the logs did not answer"
  const over = found.from === "the cluster" ? "since the pods started" : "in 24h"
  if (found.groups.length === 0) return `No errors ${over}`
  const errors = found.groups.reduce((total, group) => total + group.count, 0)
  return `${many(errors, "error", found.capped)} · ${many(found.groups.length, "group")} ${over}`
}

export const ErrorsDay = (props: { readonly service: string }) => {
  const { actions } = useEstate()
  const [found, setFound] = createSignal<Found | "none">("loading")
  let readAt = 0
  let current = true
  const read = () => {
    readAt = Date.now()
    void actions.errors(props.service, { range: "24h" }).then((answer) => {
      if (current) setFound(answer)
    })
  }
  const visible = () => document.visibilityState !== "hidden"
  read()
  // Read again while someone can see it, and on coming back to a tab left longer than that.
  const timer = setInterval(() => visible() && read(), again)
  const back = () => visible() && Date.now() - readAt >= again && read()
  document.addEventListener("visibilitychange", back)
  onCleanup(() => {
    current = false
    clearInterval(timer)
    document.removeEventListener("visibilitychange", back)
  })
  /** What is found, once a service with no logs here has been left out. */
  const shown = (): Found => {
    const value = found()
    return value === "none" ? undefined : value
  }
  const state = () => {
    const value = shown()
    if (typeof value !== "object") return "quiet"
    return value.groups.length === 0 ? "none" : "some"
  }
  return (
    <Show when={found() !== "none"}>
      <a
        class={`errors-day ${state()}`}
        href={pathOf({ page: "service", name: props.service, logs: { view: "errors", range: "24h" } })}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          goTo(event.currentTarget.getAttribute("href") ?? "")
        }}
      >
        {said(shown())}
      </a>
    </Show>
  )
}
