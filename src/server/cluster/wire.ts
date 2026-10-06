/**
 * What runners send each other: the whole estate once, then the parts that changed, and the writes a runner has made
 * to its tools for the owner to apply. Each is a schema, so a runner decodes what another sent, never trusts it.
 */
import { Schema } from "effect"
import { AgentUsage } from "../../shared/agents"
import { Catalog } from "../../shared/catalog"
import { CodeHealth } from "../../shared/code"
import { Cost } from "../../shared/costs"
import { Build } from "../../shared/deploys"
import { Alert, Load, Note, SourceKind } from "../../shared/events"
import { Debug, Job, Pod, Series } from "../../shared/workloads"
import type { EstateState } from "../state"
import { Patch } from "./patch"

const optional = Schema.optionalKey
const Strings = Schema.Record(Schema.String, Schema.String)

const PartOf = <A extends Schema.Top>(value: A) =>
  Schema.Struct({
    state: Schema.Literals(["off", "waiting", "ok", "failing"]),
    message: optional(Schema.String),
    answeredAt: optional(Schema.String),
    value: optional(value),
  })

const Points = Schema.Array(Schema.NullOr(Schema.Number))

const Metrics = Schema.Struct({
  services: Schema.Record(Schema.String, Load),
  agents: optional(Schema.Record(Schema.String, AgentUsage)),
  stores: optional(
    Schema.Record(
      Schema.String,
      Schema.Array(
        Schema.Struct({ key: Schema.String, title: Schema.String, unit: optional(Schema.String), series: Series }),
      ),
    ),
  ),
  vitals: Schema.Array(Series),
  edges: Points,
  charts: Schema.Record(Schema.String, Schema.Struct({ points: Points, threshold: Schema.Number })),
})

const {
  notes: _notes,
  service: _service,
  runbook: _runbook,
  chart: _chart,
  impact: _impact,
  ...alertFields
} = Alert.fields

const SourcedAlert = Schema.Struct({
  ...alertFields,
  runbook: optional(Schema.String),
  expression: optional(Schema.String),
  impact: optional(Schema.String),
})

const Silence = Schema.Struct({
  id: Schema.String,
  by: Schema.String,
  reason: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
})

const Workloads = Schema.Struct({
  pods: Schema.Record(Schema.String, Schema.Array(Pod)),
  jobs: optional(Schema.Record(Schema.String, Schema.Array(Job))),
  debug: Schema.Record(Schema.String, Debug),
})

const Chosen = Schema.Struct({
  version: Schema.String,
  ready: Schema.Boolean,
  at: optional(Schema.String),
  stalled: optional(Schema.String),
})

const Held = Schema.Struct({
  alert: Schema.String,
  was: Schema.Literals(["firing", "pending", "silenced"]),
  until: Schema.String,
  silence: optional(Silence),
  ended: optional(Schema.String),
})

const Environment = Schema.Struct({
  metrics: PartOf(Metrics),
  alerts: PartOf(Schema.Array(SourcedAlert)),
  cluster: PartOf(Workloads),
  deploys: PartOf(Schema.Record(Schema.String, Chosen)),
  costs: PartOf(Schema.Record(Schema.String, Cost)),
  tools: Schema.Record(SourceKind, Schema.optionalKey(Schema.String)),
  resolved: Schema.Array(
    Schema.Struct({ name: Schema.String, labels: Strings, startsAt: Schema.String, endsAt: Schema.String }),
  ),
  held: optional(Schema.Array(Held)),
})

const AlertNote = Schema.Struct({ ...Note.fields, environment: Schema.String, alert: Schema.String })

const Firing = Schema.Struct({
  environment: Schema.String,
  alert: Schema.String,
  name: Schema.String,
  service: optional(Schema.String),
  startsAt: Schema.String,
  endsAt: optional(Schema.String),
  silence: optional(Schema.Struct({ by: Schema.String, reason: Schema.String })),
})

const Thread = Schema.Struct({
  environment: Schema.String,
  alert: Schema.String,
  startsAt: Schema.String,
  channel: Schema.String,
  ts: Schema.String,
  url: Schema.String,
})

const Impact = Schema.Struct({ alert: Schema.String, text: Schema.String, by: Schema.String, at: Schema.String })

const estateFields = {
  catalog: Catalog,
  environments: Schema.Record(Schema.String, Environment),
  builds: PartOf(Schema.Record(Schema.String, Schema.Array(Build))),
  notes: Schema.Array(AlertNote),
  firings: optional(Schema.Array(Firing)),
  code: optional(PartOf(Schema.Record(Schema.String, CodeHealth))),
  threads: optional(Schema.Array(Thread)),
  impacts: optional(Schema.Array(Impact)),
}

const WireEstate = Schema.Struct(estateFields)

const { catalog: _catalog, environments: _environments, ...changeable } = estateFields

/** The estate's parts but its catalog and environments, each there only when it changed. */
const EstateParts = Schema.Struct(
  Object.fromEntries(Object.entries(changeable).map(([key, schema]) => [key, optional(schema)])) as {
    [K in keyof typeof changeable]: Schema.optionalKey<(typeof changeable)[K]>
  },
)

/** An environment's state as a follower has it once a frame's patches are applied, checked as the owner's was. */
export const decodeEnvironment = Schema.decodeUnknownResult(Environment)
/** The estate's patched parts, checked as the owner's were. */
export const decodeParts = Schema.decodeUnknownResult(EstateParts)

/** The parts a frame may patch: an environment's, and the estate's own. */
export const environmentParts: ReadonlyArray<string> = Object.keys(Environment.fields).filter((key) => key !== "tools")
export const estateParts: ReadonlyArray<string> = Object.keys(changeable)

/**
 * One frame of `Follow`: the whole estate, with the runner that reads it, when a follower starts or the catalog's
 * environments change; else how each part that changed did, by environment. An empty change is the owner saying it
 * is there.
 */
export const Frame = Schema.Union([
  Schema.TaggedStruct("Whole", { owner: Schema.String, estate: WireEstate }),
  Schema.TaggedStruct("Changed", {
    environments: Schema.Record(Schema.String, Schema.Record(Schema.String, Patch)),
    parts: Schema.Record(Schema.String, Patch),
  }),
])
export type Frame = typeof Frame.Type

/** A write a runner has made to its tool or database, for the owner to show: the same change its state would make. */
export const Write = Schema.Union([
  Schema.TaggedStruct("NoteAdded", { note: AlertNote }),
  Schema.TaggedStruct("NoteRemoved", { id: Schema.String }),
  Schema.TaggedStruct("ImpactSet", { impact: Impact }),
  Schema.TaggedStruct("ImpactCleared", { alert: Schema.String }),
  Schema.TaggedStruct("Held", {
    environment: Schema.String,
    alert: Schema.String,
    silence: Silence,
    at: Schema.Number,
  }),
  Schema.TaggedStruct("Unheld", { environment: Schema.String, id: Schema.String, at: Schema.Number }),
  Schema.TaggedStruct("ThreadKept", { thread: Thread }),
  Schema.TaggedStruct("DebugShown", { environment: Schema.String, service: Schema.String, debug: Debug }),
  Schema.TaggedStruct("FiringsKept", { firings: Schema.Array(Firing) }),
])
export type Write = typeof Write.Type

// Each is the identity, and compiles only while the schemas and the state's types agree both ways.
export const toWire = (estate: EstateState): typeof WireEstate.Type => estate
export const fromWire = (estate: typeof WireEstate.Type): EstateState => estate
