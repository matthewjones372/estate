/**
 * What Flux chose for each service: the version its ImagePolicy picked, whether its Kustomization applied, and when
 * either stalls, why, in the words Flux used.
 */
import { Effect, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Remote } from "../remote"
import type { Chosen } from "../state"
import { type Cluster, Condition, kube, Metadata } from "./kubernetes"
import type { Failure } from "./run"

const Kustomization = Schema.Struct({
  metadata: Metadata,
  status: Schema.optionalKey(
    Schema.Struct({
      conditions: Schema.optionalKey(Schema.Array(Condition)),
      lastAppliedRevision: Schema.optionalKey(Schema.String),
    }),
  ),
})

const ImagePolicy = Schema.Struct({
  metadata: Metadata,
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

const Kustomizations = Schema.Struct({ items: Schema.Array(Kustomization) })
const ImagePolicies = Schema.Struct({ items: Schema.Array(ImagePolicy) })

/** A path under one of Flux's API groups, trying its newer version first. */
const fluxGet = <S extends Schema.Decoder<unknown>>(
  cluster: Cluster,
  group: string,
  versions: ReadonlyArray<string>,
  rest: string,
  schema: S,
) => Effect.firstSuccessOf(versions.map((version) => kube(cluster, `/apis/${group}/${version}${rest}`, schema)))

const byName = <A extends { readonly metadata: { readonly name: string } }>(items: ReadonlyArray<A>) =>
  new Map(items.map((each) => [each.metadata.name, each] as const))

interface Listed {
  readonly kustomizations: ReadonlyMap<string, typeof Kustomization.Type>
  readonly policies: ReadonlyMap<string, typeof ImagePolicy.Type>
}

/** A namespace's Kustomizations, and its ImagePolicies when any service names one: a list each. */
const listedIn = (cluster: Cluster, namespace: string, policies: boolean): Effect.Effect<Listed, Failure, Remote> => {
  const path = `/namespaces/${encodeURIComponent(namespace)}`
  return Effect.all({
    kustomizations: fluxGet(
      cluster,
      "kustomize.toolkit.fluxcd.io",
      ["v1"],
      `${path}/kustomizations`,
      Kustomizations,
    ).pipe(Effect.map((listed) => byName(listed.items))),
    policies: policies
      ? fluxGet(cluster, "image.toolkit.fluxcd.io", ["v1", "v1beta2"], `${path}/imagepolicies`, ImagePolicies).pipe(
          Effect.map((listed) => byName(listed.items)),
        )
      : Effect.succeed(new Map<string, typeof ImagePolicy.Type>()),
  })
}

const namespaceOf = (service: Service) => service.deploy?.flux?.namespace ?? "flux-system"

/** What Flux chose for a service, from its namespace's lists; stalled, saying so, if what it names is not there. */
const chosenFor = (listed: Listed, service: Service): Chosen | undefined => {
  const flux = service.deploy?.flux
  if (flux === undefined) return undefined
  const kustomization = listed.kustomizations.get(flux.kustomization)
  const policy = flux.imagePolicy === undefined ? undefined : listed.policies.get(flux.imagePolicy)
  if (kustomization === undefined)
    return {
      version: "unknown",
      ready: false,
      stalled: `Flux has no Kustomization ${flux.kustomization} in ${namespaceOf(service)}`,
    }
  if (flux.imagePolicy !== undefined && policy === undefined)
    return {
      version: "unknown",
      ready: false,
      stalled: `Flux has no ImagePolicy ${flux.imagePolicy} in ${namespaceOf(service)}`,
    }
  const applied = ready(kustomization.status?.conditions)
  const revision = kustomization.status?.lastAppliedRevision
  return compact({
    version: tagOf(policy?.status) ?? (revision === undefined ? "unknown" : revisionOf(revision)),
    ready: applied?.status === "True",
    at: applied?.lastTransitionTime,
    stalled: stalledBy(policy?.status?.conditions) ?? stalledBy(kustomization.status?.conditions),
  })
}

/** Every service's choice, each namespace Flux works in listed once. */
export const readDeploys = (
  cluster: Cluster,
  services: ReadonlyArray<Service>,
): Effect.Effect<Readonly<Record<string, Chosen>>, Failure, Remote> => {
  const deployed = services.filter((service) => service.deploy?.flux !== undefined)
  const namespaces = [...new Set(deployed.map(namespaceOf))]
  return Effect.forEach(
    namespaces,
    (namespace) => {
      const here = deployed.filter((service) => namespaceOf(service) === namespace)
      const policies = here.some((service) => service.deploy?.flux?.imagePolicy !== undefined)
      return Effect.map(listedIn(cluster, namespace, policies), (listed) =>
        here.flatMap((service) => {
          const chosen = chosenFor(listed, service)
          return chosen === undefined ? [] : [[service.name, chosen] as const]
        }),
      )
    },
    { concurrency: 4 },
  ).pipe(Effect.map((read) => Object.fromEntries(read.flat())))
}
