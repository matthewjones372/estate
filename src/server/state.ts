/**
 * Everything Estate knows, in one `SubscriptionRef`: the catalog, and what each environment's sources last said.
 * Sources write their part; the event stream reads the whole and sends what changed.
 */
import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { Catalog } from "../shared/catalog"
import type { Alert, Build, Debug, Note, Pod, Series, SourceKind } from "../shared/events"

export interface Part<A> {
  readonly state: "off" | "waiting" | "ok" | "failing"
  readonly message?: string
  readonly answeredAt?: string
  readonly value?: A
}

export const off: Part<never> = { state: "off" }
export const waiting: Part<never> = { state: "waiting" }

interface ServiceLoad {
  readonly requests?: Series
  readonly errors?: Series
  readonly p99?: Series
}

interface Metrics {
  readonly services: Readonly<Record<string, ServiceLoad>>
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

interface Workloads {
  readonly pods: Readonly<Record<string, ReadonlyArray<Pod>>>
  readonly debug: Readonly<Record<string, Debug>>
}

interface Chosen {
  readonly version: string
  readonly ready: boolean
  readonly at?: string
  readonly stalled?: string
}

export interface EnvironmentState {
  readonly metrics: Part<Metrics>
  readonly alerts: Part<ReadonlyArray<SourcedAlert>>
  readonly cluster: Part<Workloads>
  readonly deploys: Part<Readonly<Record<string, Chosen>>>
  readonly resolved: ReadonlyArray<{
    readonly name: string
    readonly labels: Readonly<Record<string, string>>
    readonly startsAt: string
    readonly endsAt: string
  }>
}

export interface EstateState {
  readonly catalog: Catalog
  readonly environments: Readonly<Record<string, EnvironmentState>>
  readonly builds: Part<Readonly<Record<string, ReadonlyArray<Build>>>>
  readonly notes: ReadonlyArray<Note & { readonly environment: string; readonly alert: string }>
}

export const emptyEnvironment = (configured: ReadonlySet<SourceKind>): EnvironmentState => ({
  metrics: configured.has("metrics") ? waiting : off,
  alerts: configured.has("alerts") ? waiting : off,
  cluster: configured.has("cluster") ? waiting : off,
  deploys: configured.has("deploys") ? waiting : off,
  resolved: [],
})

export type Estate = SubscriptionRef.SubscriptionRef<EstateState>
export const Estate = Context.Service<Estate>("estate/Estate")

export const estateLayer = (initial: EstateState) => Layer.effect(Estate)(SubscriptionRef.make(initial))

export const updateEstate = (update: (state: EstateState) => EstateState): Effect.Effect<void, never, Estate> =>
  Effect.gen(function* () {
    const ref = yield* Estate
    yield* SubscriptionRef.update(ref, update)
  })
