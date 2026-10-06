/**
 * OpenCost's allocation API, or Kubecost's, which answers the same: Kubernetes' share of the bill by namespace and
 * workload, for entries that run in a shared cluster with no cost allocation tag of their own.
 */
import { Effect, Schema } from "effect"
import { compact } from "../../shared/compact"
import type { Cost } from "../../shared/costs"
import { callJson, type Remote } from "../remote"
import type { Billed } from "./aws-costs"
import { type Failure, SourceFailure } from "./run"

/** Where an entry runs in Kubernetes: its namespace, and its workload where there is one to tell it apart. */
export interface Placed extends Billed {
  readonly namespace: string
  readonly workload?: string
}

const Allocations = Schema.Struct({
  data: Schema.Array(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        properties: Schema.optionalKey(
          Schema.Struct({
            namespace: Schema.optionalKey(Schema.String),
            controller: Schema.optionalKey(Schema.String),
          }),
        ),
        totalCost: Schema.Number,
      }),
    ),
  ),
})

const decode = Schema.decodeUnknownEffect(Allocations)

/** Cost by namespace and controller over a window, OpenCost's own words for "month to date" and "yesterday". */
const allocations = (url: string, window: "month" | "yesterday") =>
  callJson({
    url: `${url.replace(/\/$/, "")}/allocation/compute?window=${window}&aggregate=namespace,controller`,
  }).pipe(
    Effect.flatMap(decode),
    Effect.map((answer) => answer.data.flatMap((set) => Object.values(set))),
    Effect.mapError(
      (error) =>
        new SourceFailure({
          message:
            error._tag === "RemoteError"
              ? `OpenCost ${error.message}`
              : "OpenCost answered in a shape Estate does not know",
        }),
    ),
  )

/** What an entry's namespace, or its workload in it, cost over what was read. */
const sumFor = (
  entry: Placed,
  read: ReadonlyArray<{ properties?: { namespace?: string; controller?: string }; totalCost: number }>,
) =>
  read
    .filter(
      ({ properties }) =>
        properties?.namespace === entry.namespace &&
        (entry.workload === undefined || properties.controller === entry.workload),
    )
    .reduce((total, each) => total + each.totalCost, 0)

/** Each placed entry's cost from OpenCost: its month to date and yesterday. */
export const readOpenCost = (
  url: string,
  entries: ReadonlyArray<Placed>,
  currency: string,
): Effect.Effect<Readonly<Record<string, Cost>>, Failure, Remote> =>
  Effect.gen(function* () {
    if (entries.length === 0) return {}
    const [month, yesterday] = yield* Effect.all([allocations(url, "month"), allocations(url, "yesterday")], {
      concurrency: 2,
    })
    return Object.fromEntries(
      entries.map((entry) => [
        entry.name,
        compact({
          from: "OpenCost",
          currency,
          monthToDate: sumFor(entry, month),
          yesterday: sumFor(entry, yesterday),
          budget: entry.cost?.budget,
        }),
      ]),
    )
  })
