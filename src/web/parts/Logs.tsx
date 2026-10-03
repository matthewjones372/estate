/** @jsxImportSource solid-js */
/** A service's logs: its lines as they arrive, and its errors grouped by message. */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { ErrorGroups, LogLine } from "../../shared/events"
import { type ErrorWindow, useEstate } from "../context"
import { clock, since } from "../format"

const kept = 500
const severity: Readonly<Record<string, number>> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
  PANIC: 5,
}
const levels = [
  { value: "all", label: "All", least: 0 },
  { value: "warn", label: "Warnings", least: 3 },
  { value: "error", label: "Errors", least: 4 },
] as const
type Level = (typeof levels)[number]["value"]

const keyOf = (line: LogLine) => `${line.at}|${line.pod ?? ""}|${line.text}`

/** New lines on the end, the same line never twice, the newest `kept`. */
const joined = (before: ReadonlyArray<LogLine>, arrived: ReadonlyArray<LogLine>) => {
  const seen = new Set(before.map(keyOf))
  return [...before, ...arrived.filter((line) => !seen.has(keyOf(line)))].slice(-kept)
}

const LineRow = (props: { readonly line: LogLine }) => (
  <li class={`log-line ${(props.line.level ?? "").toLowerCase()}`}>
    <span class="log-at">{clock(props.line.at)}</span>
    <span class="log-pod">{props.line.pod ?? ""}</span>
    <span class="log-text">{props.line.text}</span>
  </li>
)

const Live = (props: { readonly service: string }) => {
  const { actions } = useEstate()
  const [lines, setLines] = createSignal<ReadonlyArray<LogLine>>([])
  const [waiting, setWaiting] = createSignal<ReadonlyArray<LogLine>>([])
  const [from, setFrom] = createSignal<string | undefined>(undefined)
  const [missing, setMissing] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [skipped, setSkipped] = createSignal(false)
  const [failed, setFailed] = createSignal<string | undefined>(undefined)
  const [level, setLevel] = createSignal<Level>("all")
  const [text, setText] = createSignal("")
  const [box, setBox] = createSignal<HTMLOListElement | undefined>(undefined)
  const toEnd = () => queueMicrotask(() => box()?.scrollTo({ top: box()?.scrollHeight ?? 0 }))
  createEffect(
    on(
      () => props.service,
      (service) => {
        setLines([])
        setWaiting([])
        setMissing(false)
        const stop = actions.watchLogs(service, {
          from: setFrom,
          missing: () => setMissing(true),
          batch: (batch) => {
            setFailed(batch.failed)
            if (batch.skipped) setSkipped(true)
            if (paused()) setWaiting((before) => joined(before, batch.lines))
            else {
              setLines((before) => joined(before, batch.lines))
              toEnd()
            }
          },
        })
        onCleanup(stop)
      },
    ),
  )
  const least = () => levels.find((each) => each.value === level())?.least ?? 0
  const shown = () =>
    lines().filter(
      (line) =>
        (least() === 0 || (severity[line.level ?? ""] ?? 0) >= least()) &&
        (text() === "" || line.text.toLowerCase().includes(text().toLowerCase())),
    )
  const resume = () => {
    setLines((before) => joined(before, waiting()))
    setWaiting([])
    setPaused(false)
    toEnd()
  }
  const scrolled = () => {
    const list = box()
    if (list !== undefined && list.scrollTop + list.clientHeight < list.scrollHeight - 8) setPaused(true)
  }
  return (
    <Show
      when={!missing()}
      fallback={
        <p class="muted" style={{ margin: 0 }}>
          No logs are read for {props.service} here, or they are kept to operators.
        </p>
      }
    >
      <div class="log-controls">
        <fieldset class="choices bare">
          <legend class="visually-hidden">Level</legend>
          <For each={levels}>
            {(each) => (
              <button
                type="button"
                class="filter"
                aria-pressed={level() === each.value}
                onClick={() => setLevel(each.value)}
              >
                {each.label}
              </button>
            )}
          </For>
        </fieldset>
        <label class="log-search">
          <span class="visually-hidden">Lines containing</span>
          <input
            type="search"
            class="select"
            placeholder="Lines containing…"
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        </label>
        <Show
          when={paused()}
          fallback={
            <button type="button" class="plain-button push-right" onClick={() => setPaused(true)}>
              Pause
            </button>
          }
        >
          <button type="button" class="primary-button push-right log-resume" onClick={resume}>
            {waiting().length === 0 ? "Resume" : `${waiting().length} new line${waiting().length === 1 ? "" : "s"}`}
          </button>
        </Show>
      </div>
      <Show when={failed()}>{(message) => <div class="notice">The logs did not answer: {message()}</div>}</Show>
      <ol class="log-lines" ref={setBox} onScroll={scrolled} aria-live={paused() ? "off" : "polite"}>
        <For each={shown()}>{(line) => <LineRow line={line} />}</For>
      </ol>
      <p class="muted log-foot">
        {shown().length === 0 ? "No lines yet." : `${shown().length} of the last ${lines().length} lines`}
        {from() === undefined ? "" : ` · from ${from()}`}
        {skipped() ? " · busy: older lines were skipped" : ""}
      </p>
    </Show>
  )
}

const ranges = ["1h", "6h", "24h"] as const

/** The errors in a window, grouped: the commonest first, each opening to its newest examples. */
export const ErrorList = (props: {
  readonly service: string
  readonly window: ErrorWindow
  readonly most?: number
}) => {
  const { actions, now } = useEstate()
  const [groups, setGroups] = createSignal<ErrorGroups | "none" | "loading" | undefined>("loading")
  const [open, setOpen] = createSignal<string | undefined>(undefined)
  createEffect(
    on([() => props.service, () => JSON.stringify(props.window)], ([service]) => {
      let current = true
      setGroups("loading")
      void actions.errors(service, props.window).then((read) => {
        if (current) setGroups(read)
      })
      onCleanup(() => {
        current = false
      })
    }),
  )
  const read = () => {
    const value = groups()
    return typeof value === "object" ? value : undefined
  }
  return (
    <Show
      when={read()}
      fallback={
        <p class="muted" style={{ margin: 0 }}>
          {groups() === "loading"
            ? "Reading the errors…"
            : groups() === "none"
              ? `No logs are read for ${props.service} here, or they are kept to operators.`
              : "The logs did not answer."}
        </p>
      }
    >
      {(found) => (
        <Show
          when={found().groups.length > 0}
          fallback={
            <p class="muted" style={{ margin: 0 }}>
              No errors.
            </p>
          }
        >
          <ol class="error-groups">
            <For each={found().groups.slice(0, props.most ?? 50)}>
              {(group) => (
                <li class="error-group">
                  <button
                    type="button"
                    class="error-head"
                    aria-expanded={open() === group.shape}
                    onClick={() => setOpen(open() === group.shape ? undefined : group.shape)}
                  >
                    <span class="error-count">{group.count}×</span>
                    <span class="mono error-shape">{group.shape}</span>
                    <span class="muted error-when">
                      last {since(group.lastSeen, now())} ago · {group.pods.join(", ")}
                    </span>
                  </button>
                  <Show when={open() === group.shape}>
                    <ol class="log-lines examples">
                      <For each={group.examples}>{(line) => <LineRow line={line} />}</For>
                    </ol>
                  </Show>
                </li>
              )}
            </For>
          </ol>
        </Show>
      )}
    </Show>
  )
}

const Errors = (props: { readonly service: string }) => {
  const [range, setRange] = createSignal<(typeof ranges)[number]>("1h")
  return (
    <div class="stack">
      <fieldset class="choices bare">
        <legend class="visually-hidden">Over</legend>
        <For each={ranges}>
          {(each) => (
            <button type="button" class="filter" aria-pressed={range() === each} onClick={() => setRange(each)}>
              {each}
            </button>
          )}
        </For>
      </fieldset>
      <ErrorList service={props.service} window={{ range: range() }} />
    </div>
  )
}

export const LogsPanel = (props: { readonly service: string }) => {
  const [view, setView] = createSignal<"live" | "errors">("live")
  return (
    <section aria-labelledby="logs" class="panel section-box">
      <div class="spread">
        <h2 id="logs" class="section-title">
          Logs
        </h2>
        <fieldset class="choices bare">
          <legend class="visually-hidden">Logs view</legend>
          <button type="button" class="filter" aria-pressed={view() === "live"} onClick={() => setView("live")}>
            Live
          </button>
          <button type="button" class="filter" aria-pressed={view() === "errors"} onClick={() => setView("errors")}>
            Errors
          </button>
        </fieldset>
      </div>
      <Show when={view() === "live"} fallback={<Errors service={props.service} />}>
        <Live service={props.service} />
      </Show>
    </section>
  )
}
