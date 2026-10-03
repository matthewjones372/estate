/**
 * Everything Estate knows, in one `SubscriptionRef`: the catalog, and what each environment's sources last said.
 * Sources write their part; the event stream reads the whole and sends what changed.
 */
import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { Catalog } from "../shared/catalog"
import type { Alert, Build, Debug, Job, Load, Note, Pod, Series, SourceKind } from "../shared/events"

export interface Part<A> {
  readonly state: "off" | "waiting" | "ok" | "failing"
  readonly message?: string
  readonly answeredAt?: string
  readonly value?: A
}

export const off: Part<never> = { state: "off" }
export const waiting: Part<never> = { state: "waiting" }

export type ServiceLoad = Load

/** One of a store's stats over the last hour. */
export interface StoreReading {
  readonly key: string
  readonly title: string
  readonly unit?: string
  readonly series: Series
}

export interface Metrics {
  readonly services: Readonly<Record<string, ServiceLoad>>
  readonly stores?: Readonly<Record<string, ReadonlyArray<StoreReading>>>
  readonly vitals: ReadonlyArray<Series>
  readonly edges: ReadonlyArray<number | null>
  readonly charts: Readonly<
    Record<string, { readonly points: ReadonlyArray<number | null>; readonly threshold: number }>
  >
}

export type SourcedAlert = Omit<Alert, "notes" | "service" | "runbook" | "chart"> & {
  readonly runbook?: string
  readonly expression?: string
}

export interface Workloads {
  readonly pods: Readonly<Record<string, ReadonlyArray<Pod>>>
  readonly jobs?: Readonly<Record<string, ReadonlyArray<Job>>>
  readonly debug: Readonly<Record<string, Debug>>
}

export interface Chosen {
  readonly version: string
  readonly ready: boolean
  readonly at?: string
  readonly stalled?: string
}

/** A silence Estate wrote or ended, shown so until the manager's answer agrees or `until` passes. */
export interface Held {
  readonly alert: string
  /** The alert's state before the silence, shown again when it ends. */
  readonly was: SourcedAlert["state"]
  readonly until: string
  /** Silenced with this, or ended the silence with this id. */
  readonly silence?: NonNullable<SourcedAlert["silence"]>
  readonly ended?: string
}

export interface EnvironmentState {
  readonly metrics: Part<Metrics>
  readonly alerts: Part<ReadonlyArray<SourcedAlert>>
  readonly cluster: Part<Workloads>
  readonly deploys: Part<Readonly<Record<string, Chosen>>>
  /** The tool each part is read from, by its own name, for the page to say: Prometheus, Datadog, Harness… */
  readonly tools: Tools
  readonly resolved: ReadonlyArray<{
    readonly name: string
    readonly labels: Readonly<Record<string, string>>
    readonly startsAt: string
    readonly endsAt: string
  }>
  /** Silences Estate wrote or ended that the manager's answers do not show yet. */
  readonly held?: ReadonlyArray<Held>
}

export interface EstateState {
  readonly catalog: Catalog
  readonly environments: Readonly<Record<string, EnvironmentState>>
  readonly builds: Part<Readonly<Record<string, ReadonlyArray<Build>>>>
  readonly notes: ReadonlyArray<Note & { readonly environment: string; readonly alert: string }>
}

export type Tools = Readonly<Partial<Record<SourceKind, string>>>

export const emptyEnvironment = (configured: ReadonlySet<SourceKind>, tools: Tools = {}): EnvironmentState => ({
  metrics: configured.has("metrics") ? waiting : off,
  alerts: configured.has("alerts") ? waiting : off,
  cluster: configured.has("cluster") ? waiting : off,
  deploys: configured.has("deploys") ? waiting : off,
  tools,
  resolved: [],
})

export type Estate = SubscriptionRef.SubscriptionRef<EstateState>
export const Estate = Context.Service<Estate>("estate/Estate")

export const estateLayer = (initial: EstateState) => Layer.effect(Estate)(SubscriptionRef.make(initial))

/** Updates one environment's state, if it is still in the catalog. */
export const updateEnvironment = (
  environment: string,
  update: (state: EnvironmentState) => EnvironmentState,
): Effect.Effect<void, never, Estate> =>
  updateEstate((estate) => {
    const current = estate.environments[environment]
    return current === undefined
      ? estate
      : { ...estate, environments: { ...estate.environments, [environment]: update(current) } }
  })

export const updateEstate = (update: (state: EstateState) => EstateState): Effect.Effect<void, never, Estate> =>
  Effect.gen(function* () {
    const ref = yield* Estate
    yield* SubscriptionRef.update(ref, update)
  })
