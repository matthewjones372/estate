/**
 * Reading back what the incident tool says of each open incident raised in it (spec 0043), every so often. It is
 * kept in the state, as every source's answer is, and never in the notes store: the tool keeps it.
 */
import { type Duration, Effect, SubscriptionRef } from "effect"
import { compact } from "../../shared/compact"
import type { ReadBack } from "../../shared/incidents"
import type { Remote } from "../remote"
import { forEver } from "../schedule"
import { Estate, updateEstate } from "../state"
import type { IncidentTool } from "./incident-tools"

/** Why the tool did not answer, without its own name, which the page says before it. */
const reasonOf = (tool: string, message: string) => {
  const own = message.startsWith(`${tool} `) ? message.slice(tool.length + 1) : message
  return own.startsWith("answered ") ? own.slice("answered ".length) : own
}

export const readBack = (tool: IncidentTool, every: Duration.Input): Effect.Effect<never, never, Estate | Remote> =>
  forEver(
    Effect.gen(function* () {
      const { incidents = [] } = yield* SubscriptionRef.get(yield* Estate)
      const raised = incidents.flatMap((incident) =>
        incident.closedAt === undefined && incident.raised !== undefined ? [[incident.id, incident.raised.id]] : [],
      )
      const read = yield* Effect.forEach(
        raised,
        ([incident = "", id = ""]) =>
          Effect.map(Effect.result(tool.read(id)), (result): readonly [string, ReadBack] => [
            incident,
            result._tag === "Success"
              ? {
                  tool: tool.name,
                  said: compact({
                    status: result.success.status,
                    severity: result.success.severity,
                    responders: result.success.responders,
                  }),
                }
              : { tool: tool.name, failing: reasonOf(tool.name, result.failure.message) },
          ]),
        { concurrency: 4 },
      )
      yield* updateEstate((estate) => ({ ...estate, inTool: Object.fromEntries(read) }))
    }),
    every,
  )
