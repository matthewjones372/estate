/** @jsxImportSource solid-js */
/** One of a service's log lines: its time, pod, level badge, what wrote it, its trace and text, coloured by its level. */
import { For, Show } from "solid-js"
import type { LogLine } from "../../shared/log-events"
import { clock } from "../format"
import { levelOf } from "../log-copy"
import { marked, type Search } from "../log-search"
import { pathOf } from "../route"
import { A } from "./A"

export const kinds = [
  { value: "error", label: "Error", levels: ["ERROR", "FATAL", "PANIC"] },
  { value: "warn", label: "Warn", levels: ["WARN", "WARNING"] },
  { value: "info", label: "Info", levels: ["INFO"] },
  { value: "debug", label: "Debug", levels: ["DEBUG", "TRACE"] },
  { value: "other", label: "Other", levels: [] },
] as const
export type Kind = (typeof kinds)[number]["value"]

/** The kind a line's level is; a line with no level, or one not known here, is `other`. */
export const kindOf = (line: LogLine): Kind =>
  kinds.find((kind) => (kind.levels as ReadonlyArray<string>).includes(levelOf(line)))?.value ?? "other"

const empty: Search = { _tag: "Empty" }

/** A line, and when it is in the Live view, a way to pick it and to copy it alone, with where it is from. */
export const LineRow = (props: {
  readonly line: LogLine
  readonly search?: Search
  /** Shown only for being near a match (spec 0067), and whether held lines were skipped before it. */
  readonly around?: boolean
  readonly gap?: boolean
  readonly picked?: boolean
  readonly onPick?: (range: boolean) => void
  readonly onCopy?: () => void
}) => (
  <li
    class={`log-line ${kindOf(props.line)}`}
    classList={{ picked: props.picked === true, around: props.around === true, gap: props.gap === true }}
  >
    <Show when={props.onPick} fallback={<span class="log-at">{clock(props.line.at)}</span>}>
      {(pick) => (
        <button
          type="button"
          class="log-at log-pick"
          aria-pressed={props.picked === true}
          onClick={(event) => pick()(event.shiftKey)}
        >
          {clock(props.line.at)}
        </button>
      )}
    </Show>
    <span class="log-pod">{props.line.pod ?? ""}</span>
    <span class="log-level">
      {levelOf(props.line)}
      <Show when={props.around}>
        <span class="visually-hidden"> around a match</span>
      </Show>
    </span>
    <span class="log-body">
      <Show when={props.line.logger !== undefined || props.line.trace !== undefined}>
        <span class="log-fields">
          <Show when={props.line.logger}>
            {(logger) => (
              <span class="log-logger" title={`Written by ${logger()}`}>
                {logger()}
              </span>
            )}
          </Show>
          <Show when={props.line.trace}>
            {(trace) => (
              <A to={pathOf({ page: "trace", id: trace() })} class="log-trace" title={`Open trace ${trace()}`}>
                trace {trace().slice(0, 8)}
              </A>
            )}
          </Show>
        </span>
      </Show>
      <span class="log-text">
        <For each={marked(props.line.text, props.around === true ? empty : (props.search ?? empty))}>
          {(part) => (part.mark ? <mark>{part.text}</mark> : part.text)}
        </For>
      </span>
    </span>
    <Show when={props.onCopy}>
      <button type="button" class="log-copy-one" onClick={() => props.onCopy?.()}>
        <span aria-hidden="true">⧉</span>
        <span class="visually-hidden">Copy this line</span>
      </button>
    </Show>
  </li>
)
