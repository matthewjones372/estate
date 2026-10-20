/** @jsxImportSource solid-js */
/** A service's logs: its lines as they arrive, and its errors grouped by message. */
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { LogLine } from "../../shared/log-events"
import { replaceAddress } from "../address"
import { useEstate, useSnapshot } from "../context"
import { asText, copy, fileName, save } from "../log-copy"
import { searchOf, shows } from "../log-search"
import { type ErrorRange, type LogsShown, pathOf } from "../route"
import { IncludeInIncident } from "./IncludeInIncident"
import { Errors } from "./LogErrors"
import { type Kind, kindOf, kinds, LineRow } from "./LogLine"

const kept = 500
const keyOf = (line: LogLine) => `${line.at}|${line.pod ?? ""}|${line.text}`

/** New lines on the end, the same line never twice, the newest `kept`. */
const joined = (before: ReadonlyArray<LogLine>, arrived: ReadonlyArray<LogLine>) => {
  const seen = new Set(before.map(keyOf))
  return [...before, ...arrived.filter((line) => !seen.has(keyOf(line)))].slice(-kept)
}

const Live = (props: { readonly service: string }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [lines, setLines] = createSignal<ReadonlyArray<LogLine>>([])
  const [waiting, setWaiting] = createSignal<ReadonlyArray<LogLine>>([])
  const [from, setFrom] = createSignal<string | undefined>(undefined)
  const [missing, setMissing] = createSignal(false)
  const [paused, setPaused] = createSignal(false)
  const [skipped, setSkipped] = createSignal(false)
  const [failed, setFailed] = createSignal<string | undefined>(undefined)
  const [hidden, setHidden] = createSignal<ReadonlySet<Kind>>(new Set())
  const [text, setText] = createSignal("")
  const [picked, setPicked] = createSignal<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = createSignal<string | undefined>(undefined)
  const [told, setTold] = createSignal("")
  const [box, setBox] = createSignal<HTMLOListElement | undefined>(undefined)
  const toEnd = () => queueMicrotask(() => box()?.scrollTo({ top: box()?.scrollHeight ?? 0 }))
  createEffect(
    on(
      () => props.service,
      (service) => {
        setLines([])
        setWaiting([])
        setPicked(new Set<string>())
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
  const toggle = (kind: Kind) =>
    setHidden((before) => {
      const after = new Set(before)
      if (!after.delete(kind)) after.add(kind)
      return after
    })
  const count = (kind: Kind) => lines().filter((line) => kindOf(line) === kind).length
  // Worked out once a change, not on every read: the list, its footer, the copy and each picked range read them.
  const search = createMemo(() => searchOf(text()))
  const shown = createMemo(() => lines().filter((line) => !hidden().has(kindOf(line)) && shows(search(), line.text)))
  const pick = (line: LogLine, range: boolean) => {
    const key = keyOf(line)
    const keys = shown().map(keyOf)
    const from = keys.indexOf(anchor() ?? "")
    setPicked((before) => {
      const after = new Set(before)
      if (range && from !== -1) {
        const to = keys.indexOf(key)
        for (const each of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) after.add(each)
      } else if (!after.delete(key)) after.add(key)
      return after
    })
    setAnchor(key)
    setPaused(true)
  }
  const chosen = () => {
    const some = shown().filter((line) => picked().has(keyOf(line)))
    return some.length > 0 ? some : shown()
  }
  const lineCount = (count: number) => `${count} line${count === 1 ? "" : "s"}`
  const copyChosen = () => {
    const count = chosen().length
    void copy(asText(chosen())).then(() => setTold(`Copied ${lineCount(count)}`))
  }
  const clear = (event: KeyboardEvent) => {
    if (event.key === "Escape") setPicked(new Set<string>())
  }
  document.addEventListener("keydown", clear)
  onCleanup(() => document.removeEventListener("keydown", clear))
  createEffect(
    on(told, (said) => {
      if (said === "") return
      const timer = setTimeout(() => setTold(""), 2000)
      onCleanup(() => clearTimeout(timer))
    }),
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
      fallback={<p class="muted flush">No logs are read for {props.service} here, or they are kept to operators.</p>}
    >
      <div class="log-controls">
        <fieldset class="choices bare">
          <legend class="visually-hidden">Levels shown</legend>
          <For each={kinds}>
            {(kind) => (
              <button
                type="button"
                class={`filter level-${kind.value}`}
                aria-pressed={!hidden().has(kind.value)}
                onClick={() => toggle(kind.value)}
              >
                {kind.label} {count(kind.value)}
              </button>
            )}
          </For>
        </fieldset>
        <label class="log-search">
          <span class="visually-hidden">Lines containing</span>
          <input
            type="search"
            class="select"
            placeholder="Search, a*b or /regex/"
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
          />
        </label>
        <Show when={search()._tag === "Invalid"}>
          <span class="log-invalid" role="status">
            Not a valid pattern
          </span>
        </Show>
        <button type="button" class="plain-button push-right" onClick={copyChosen}>
          Copy {lineCount(chosen().length)}
        </button>
        <button
          type="button"
          class="plain-button"
          onClick={() => save(fileName(props.service, snapshot.environment, Date.now()), asText(chosen()))}
        >
          Save
        </button>
        <IncludeInIncident
          label={`Include ${lineCount(chosen().length)}…`}
          what={() => ({ kind: "lines", environment: snapshot.environment, service: props.service, lines: chosen() })}
        />
        <span class="log-told" role="status">
          {told()}
        </span>
        <Show
          when={paused()}
          fallback={
            <button type="button" class="plain-button" onClick={() => setPaused(true)}>
              Pause
            </button>
          }
        >
          <button type="button" class="primary-button log-resume" onClick={resume}>
            {waiting().length === 0 ? "Resume" : `${waiting().length} new line${waiting().length === 1 ? "" : "s"}`}
          </button>
        </Show>
      </div>
      <Show when={failed()}>{(message) => <div class="notice">The logs did not answer: {message()}</div>}</Show>
      <ol class="log-lines" ref={setBox} onScroll={scrolled}>
        <For each={shown()}>
          {(line) => (
            <LineRow
              line={line}
              search={search()}
              picked={picked().has(keyOf(line))}
              onPick={(range) => pick(line, range)}
            />
          )}
        </For>
      </ol>
      <p class="muted log-foot">
        {search()._tag === "Pattern"
          ? `${shown().length} of the last ${lines().length} lines match`
          : shown().length === 0
            ? "No lines yet."
            : `${shown().length} of the last ${lines().length} lines`}
        {from() === undefined ? "" : ` · from ${from()}`}
        {skipped() ? " · busy: older lines were skipped" : ""}
        {
          " · Copy and Save take the lines held here, at most 500, or those picked: a line's time picks it, shift-click the lines between"
        }
      </p>
    </Show>
  )
}

const shownFirst: LogsShown = { view: "live", range: "1h" }

/** A service's logs, showing what its page's address asks for, and writing what is chosen here back to it. */
export const LogsPanel = (props: { readonly service: string; readonly shown?: LogsShown | undefined }) => {
  const [shown, setShown] = createSignal(props.shown ?? shownFirst)
  let panel: HTMLElement | undefined
  // The address changed, by a link to these logs or Back: show what it asks for, and bring it into view.
  createEffect(
    on(
      () => props.shown,
      (asked) => {
        setShown(asked ?? shownFirst)
        if (asked?.view === "errors") panel?.scrollIntoView?.({ block: "start" })
      },
      { defer: true },
    ),
  )
  const view = () => shown().view
  const choose = (chosen: LogsShown) => {
    setShown(chosen)
    replaceAddress(pathOf({ page: "service", name: props.service, logs: chosen }))
  }
  const setView = (chosen: "live" | "errors") => choose({ ...shown(), view: chosen })
  const setRange = (range: ErrorRange) => choose({ ...shown(), range })
  return (
    <section aria-labelledby="logs" class="panel section-box" ref={panel}>
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
      <Show
        when={view() === "live"}
        fallback={<Errors service={props.service} range={shown().range} choose={setRange} />}
      >
        <Live service={props.service} />
      </Show>
    </section>
  )
}
