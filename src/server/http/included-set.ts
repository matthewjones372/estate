/**
 * What a person includes in an incident from where they found it (spec 0051), as a set of evidence with one item: a
 * chart read again from the catalog's query over the range they had on screen, or lines and an error group as shown.
 */
import { Effect, SubscriptionRef } from "effect"
import type { EvidenceSet } from "../../shared/evidence"
import type { Included } from "../../shared/included"
import { windowOf } from "../../shared/window"
import { chartsOf } from "../evidence"
import { Configured } from "../settings"
import { rangesIn } from "../sources/ranges"
import { Estate } from "../state"
import { refuse } from "./incident-record"

const mostLines = 500

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "16:00", in UTC. */
const clock = (instant: number) => new Date(instant).toISOString().slice(11, 16)

/** "12 Oct 16:00", in UTC, as the event says a range. */
const at = (instant: number) => {
  const date = new Date(instant)
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${clock(instant)}`
}

/** What it is, as an event and a removal name it: "orders errors, 12 Oct 16:00 to 17:00 UTC". */
export const named = (included: Included) => {
  switch (included.kind) {
    case "chart": {
      const [from, to] = [Date.parse(included.from), Date.parse(included.to)]
      return `${included.service} ${included.panel}, ${at(from)} to ${clock(to)} UTC`
    }
    case "lines":
      return `${included.lines.length} ${included.lines.length === 1 ? "line" : "lines"} of ${included.service}`
    case "errors":
      return `${included.service}'s error "${included.group.shape}"`
  }
}

const chartOf = (included: Extract<Included, { readonly kind: "chart" }>) =>
  Effect.gen(function* () {
    const [from, to] = [Date.parse(included.from), Date.parse(included.to)]
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to)
      return yield* refuse(400, "a chart's range is from and to, from first")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const place = estate.catalog.environments.find((each) => each.name === included.environment)
    const ranges = place === undefined ? undefined : yield* rangesIn(settings.sources[place.sources] ?? {})
    const window = windowOf(from, to)
    const charts =
      ranges === undefined
        ? []
        : yield* chartsOf(
            estate.catalog,
            ranges,
            included.service,
            included.environment,
            { seconds: window.end - window.start, step: window.step },
            window.end * 1000,
          )
    const chart = charts.find((each) => each.panel === included.panel)
    if (chart === undefined)
      return yield* refuse(404, `${included.service} has no chart named ${included.panel} in ${included.environment}`)
    return { window, charts: [chart] }
  })

/** The set it is kept as, by `by`, read from the sources now where it is a chart. */
export const includedSet = (included: Included, by: string, keptAt: string) =>
  Effect.gen(function* () {
    const { environment, service } = included
    const now = Date.parse(keptAt)
    const empty = { window: windowOf(now, now + 1), charts: [] }
    const read =
      included.kind === "chart"
        ? yield* chartOf(included)
        : included.kind === "lines" && included.lines.length > mostLines
          ? yield* refuse(400, `at most ${mostLines} lines are included at once`)
          : empty
    const logs =
      included.kind === "chart"
        ? undefined
        : [
            {
              service,
              environment,
              from: "included",
              errors: included.kind === "errors" ? [included.group] : [],
              lines: included.kind === "lines" ? included.lines : [],
              leftOut: 0,
            },
          ]
    const set: EvidenceSet = {
      id: crypto.randomUUID(),
      keptAt,
      keptBy: by,
      ...read,
      ...(logs === undefined ? {} : { logs }),
      from: "included",
      ...(included.why === undefined || included.why.trim() === "" ? {} : { why: included.why.trim() }),
    }
    return set
  })
