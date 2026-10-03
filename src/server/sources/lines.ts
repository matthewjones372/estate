/**
 * A service's log lines in Estate's words: each with its time, pod and level, masked before it leaves, and errors
 * grouped by their message with the parts that vary taken out, so that one fault is one row.
 */
import { Result } from "effect"
import { compact } from "../../shared/compact"

export interface Line {
  readonly at: string
  readonly pod?: string
  readonly level?: string
  readonly text: string
}

const levels = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|PANIC)\b/i

const parsed = (text: string): Readonly<Record<string, unknown>> | undefined => {
  if (!text.startsWith("{")) return undefined
  const value: unknown = Result.getOrUndefined(Result.try(() => JSON.parse(text)))
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

const field = (json: Readonly<Record<string, unknown>> | undefined, ...names: ReadonlyArray<string>) => {
  for (const name of names) if (typeof json?.[name] === "string") return json[name] as string
  return undefined
}

/** A line's level: a JSON line's own, or the first level word in its text. */
export const levelOf = (text: string): string | undefined =>
  (field(parsed(text), "level", "severity", "lvl") ?? levels.exec(text)?.[1])?.toUpperCase().replace("WARNING", "WARN")

/** A line as read, with its level found. */
export const lineOf = (at: string, text: string, pod?: string): Line =>
  compact({ at, pod, level: levelOf(text), text: text.trimEnd() })

const defaultErrors = /\b(error|fatal|panic)\b|exception\b/i

/** Whether a line is an error, by the catalog's pattern or the default, against its level or else its text. */
export const errorTest = (pattern: string | undefined) => {
  const errors = pattern === undefined ? defaultErrors : new RegExp(pattern, "i")
  return (line: Line) => errors.test(line.level ?? line.text)
}

/** Replaces what each pattern matches with •••, so it never leaves Estate. */
export const masking = (patterns: ReadonlyArray<string> | undefined) => {
  const masks = (patterns ?? []).map((pattern) => new RegExp(pattern, "g"))
  return (line: Line): Line =>
    masks.length === 0 ? line : { ...line, text: masks.reduce((text, mask) => text.replace(mask, "•••"), line.text) }
}

const varying: ReadonlyArray<readonly [RegExp, string]> = [
  [/\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:?\d\d)?/g, "‹time›"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "‹id›"],
  [/\b[0-9a-f]{12,}\b/gi, "‹id›"],
  [/"[^"]*"|'[^']*'/g, "‹…›"],
  [/\b\d+(\.\d+)?\b/g, "‹n›"],
]

/** What a message says once its times, ids, quoted values and numbers are taken out. */
export const shapeOf = (line: Line): string => {
  const message = field(parsed(line.text), "message", "msg", "error") ?? line.text
  return varying.reduce((text, [pattern, mark]) => text.replace(pattern, mark), message).slice(0, 300)
}

export interface ErrorGroup {
  readonly shape: string
  readonly count: number
  readonly firstSeen: string
  readonly lastSeen: string
  readonly pods: ReadonlyArray<string>
  /** The newest ten, newest first. */
  readonly examples: ReadonlyArray<Line>
}

/** Errors grouped by their message's shape, the commonest first. */
export const groupErrors = (
  lines: ReadonlyArray<Line>,
  isError: (line: Line) => boolean,
): ReadonlyArray<ErrorGroup> => {
  const groups = new Map<string, Array<Line>>()
  for (const line of lines.filter(isError)) {
    const shape = shapeOf(line)
    groups.set(shape, [...(groups.get(shape) ?? []), line])
  }
  return [...groups.entries()]
    .map(([shape, members]) => {
      const sorted = [...members].sort((a, b) => b.at.localeCompare(a.at))
      return {
        shape,
        count: members.length,
        firstSeen: sorted.at(-1)?.at ?? "",
        lastSeen: sorted[0]?.at ?? "",
        pods: [...new Set(members.flatMap((line) => (line.pod === undefined ? [] : [line.pod])))].sort(),
        examples: sorted.slice(0, 10),
      }
    })
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
}
