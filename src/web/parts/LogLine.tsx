/** @jsxImportSource solid-js */
/** One of a service's log lines: its time, pod, level badge and text, coloured by its level. */
import { For, Show } from "solid-js"
import type { LogLine } from "../../shared/log-events"
import { clock } from "../format"
import { asText, copy, levelOf } from "../log-copy"
import { marked, type Search } from "../log-search"

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

/** A line, and when it is in the Live view, a way to pick it and to copy it alone. */
export const LineRow = (props: {
  readonly line: LogLine
  readonly search?: Search
  readonly picked?: boolean
  readonly onPick?: (range: boolean) => void
}) => (
  <li class={`log-line ${kindOf(props.line)}`} classList={{ picked: props.picked === true }}>
    <Show when={props.onPick} fallback={<span class="log-at">{clock(props.line.at)}</span>}>
      {(pick) => (
        <button
          type="button"
          class="log-at log-pick"
          aria-pressed={props.picked === true}
          title="Pick this line; shift-click to pick the lines between"
          onClick={(event) => pick()(event.shiftKey)}
        >
          {clock(props.line.at)}
        </button>
      )}
    </Show>
    <span class="log-pod">{props.line.pod ?? ""}</span>
    <span class="log-level">{levelOf(props.line)}</span>
    <span class="log-text">
      <For each={marked(props.line.text, props.search ?? empty)}>
        {(part) => (part.mark ? <mark>{part.text}</mark> : part.text)}
      </For>
    </span>
    <Show when={props.onPick}>
      <button type="button" class="log-copy-one" onClick={() => void copy(asText([props.line]))}>
        <span aria-hidden="true">⧉</span>
        <span class="visually-hidden">Copy this line</span>
      </button>
    </Show>
  </li>
)
