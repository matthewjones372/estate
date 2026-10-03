/**
 * What Flux chose for each service: the version its ImagePolicy picked, whether its Kustomization applied, and when
 * either stalls, why, in the words Flux used.
 */
import { Effect, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Remote } from "../remote"
import type { Chosen } from "../state"
import { type Cluster, Condition, kube } from "./kubernetes"
import type { Failure } from "./run"

const Kustomization = Schema.Struct({
  status: Schema.optionalKey(
    Schema.Struct({
      conditions: Schema.optionalKey(Schema.Array(Condition)),
      lastAppliedRevision: Schema.optionalKey(Schema.String),
    }),
  ),
})

const ImagePolicy = Schema.Struct({
  status: Schema.optionalKey(
    Schema.Struct({
      conditions: Schema.optionalKey(Schema.Array(Condition)),
      latestImage: Schema.optionalKey(Schema.String),
      latestRef: Schema.optionalKey(Schema.Struct({ tag: Schema.optionalKey(Schema.String) })),
    }),
  ),
})

type Conditions = ReadonlyArray<typeof Condition.Type> | undefined

const ready = (conditions: Conditions) => conditions?.find((condition) => condition.type === "Ready")

/** Why a Ready condition says no, when it says no rather than "still working". */
const stalledBy = (conditions: Conditions): string | undefined => {
  const condition = ready(conditions)
  return condition?.status === "False" ? (condition.message ?? condition.reason ?? "not ready") : undefined
}

/** "main@sha1:0123456789abcdef" is "main@0123456". */
export const revisionOf = (revision: string): string => revision.replace(/@sha\d*:([0-9a-f]{7})[0-9a-f]*$/, "@$1")

/** The tag an ImagePolicy chose, from its latest reference or image. */
export const tagOf = (status: (typeof ImagePolicy.Type)["status"]): string | undefined => {
  const tag = status?.latestRef?.tag
  if (tag !== undefined) return tag
  const image = status?.latestImage
  return image === undefined ? undefined : image.slice(image.lastIndexOf(":") + 1)
}

/** A path under one of Flux's API groups, trying its newer version first. */
const fluxGet = <S extends Schema.Decoder<unknown>>(
  cluster: Cluster,
  group: string,
  versions: ReadonlyArray<string>,
  rest: string,
  schema: S,
) => Effect.firstSuccessOf(versions.map((version) => kube(cluster, `/apis/${group}/${version}${rest}`, schema)))

const chosenFor = (cluster: Cluster, service: Service): Effect.Effect<Chosen | undefined, Failure, Remote> => {
  const flux = service.deploy?.flux
  if (flux === undefined) return Effect.succeed(undefined)
  const namespace = encodeURIComponent(flux.namespace ?? "flux-system")
  return Effect.gen(function* () {
    const kustomization = yield* fluxGet(
      cluster,
      "kustomize.toolkit.fluxcd.io",
      ["v1"],
      `/namespaces/${namespace}/kustomizations/${encodeURIComponent(flux.kustomization)}`,
      Kustomization,
    )
    const policy =
      flux.imagePolicy === undefined
        ? undefined
        : yield* fluxGet(
            cluster,
            "image.toolkit.fluxcd.io",
            ["v1", "v1beta2"],
            `/namespaces/${namespace}/imagepolicies/${encodeURIComponent(flux.imagePolicy)}`,
            ImagePolicy,
          )
    const applied = ready(kustomization.status?.conditions)
    const revision = kustomization.status?.lastAppliedRevision
    return compact({
      version: tagOf(policy?.status) ?? (revision === undefined ? "unknown" : revisionOf(revision)),
      ready: applied?.status === "True",
      at: applied?.lastTransitionTime,
      stalled: stalledBy(policy?.status?.conditions) ?? stalledBy(kustomization.status?.conditions),
    })
  })
}

/** Every service's choice, read side by side. */
export const readDeploys = (
  cluster: Cluster,
  services: ReadonlyArray<Service>,
): Effect.Effect<Readonly<Record<string, Chosen>>, Failure, Remote> =>
  Effect.forEach(
    services,
    (service) => chosenFor(cluster, service).pipe(Effect.map((chosen) => [service.name, chosen] as const)),
    { concurrency: 4 },
  ).pipe(
    Effect.map((read) =>
      Object.fromEntries(read.flatMap(([name, chosen]) => (chosen === undefined ? [] : [[name, chosen]]))),
    ),
  )
