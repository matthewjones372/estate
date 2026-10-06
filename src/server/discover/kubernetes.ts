/**
 * Services found in Kubernetes (spec 0031): the Deployments and StatefulSets a rule's selector matches, each made the
 * catalog entry a person would write for it, from the rule's template and the workload's labels and annotations.
 */
import { Effect, Schema } from "effect"
import type { DiscoverRule, Service } from "../../shared/catalog"
import { placeholder } from "../../shared/check-discover"
import type { Remote } from "../remote"
import { type Cluster, kube } from "../sources/kubernetes"
import type { Failure } from "../sources/run"

const Found = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      metadata: Schema.Struct({
        name: Schema.String,
        namespace: Schema.String,
        labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      }),
    }),
  ),
})

/** A workload a rule found: its kind, and its name, namespace, labels and annotations. */
export interface Workload {
  readonly kind: "Deployment" | "StatefulSet"
  readonly name: string
  readonly namespace: string
  readonly labels: Readonly<Record<string, string>>
  readonly annotations: Readonly<Record<string, string>>
}

const plural = { Deployment: "deployments", StatefulSet: "statefulsets" } as const

/** The workloads a rule's selector matches in one cluster, in its namespaces or in all. */
export const workloadsIn = (
  cluster: Cluster,
  rule: NonNullable<DiscoverRule["kubernetes"]>,
): Effect.Effect<ReadonlyArray<Workload>, Failure, Remote> => {
  const where = rule.namespaces?.map((namespace) => `/namespaces/${encodeURIComponent(namespace)}`) ?? [""]
  const query = `?labelSelector=${encodeURIComponent(rule.selector)}`
  return Effect.forEach(
    where.flatMap((path) => (["Deployment", "StatefulSet"] as const).map((kind) => [path, kind] as const)),
    ([path, kind]) =>
      Effect.map(kube(cluster, `/apis/apps/v1${path}/${plural[kind]}${query}`, Found), (found) =>
        found.items.map(
          ({ metadata }): Workload => ({
            kind,
            name: metadata.name,
            namespace: metadata.namespace,
            labels: metadata.labels ?? {},
            annotations: metadata.annotations ?? {},
          }),
        ),
      ),
    { concurrency: 4 },
  ).pipe(Effect.map((each) => each.flat()))
}

/** A service's name: its app.kubernetes.io/name label, or else its workload's name. */
const serviceName = (workload: Workload) => workload.labels["app.kubernetes.io/name"] ?? workload.name

/** What a template is filled from: a found thing's service name, namespace, labels and annotations. */
export interface Values {
  readonly service: string
  readonly namespace?: string
  readonly labels: Readonly<Record<string, string>>
  readonly annotations: Readonly<Record<string, string>>
}

const valuesOf = (workload: Workload): Values => ({
  service: serviceName(workload),
  namespace: workload.namespace,
  labels: workload.labels,
  annotations: workload.annotations,
})

/** `text` with the found thing's values in place; none when it names a value the thing lacks. */
const fill = (text: string, workload: Values): string | undefined => {
  let missing = false
  const filled = text.replace(placeholder, (whole, name: string) => {
    const [kind, key = ""] = name.split(/:(.*)/)
    const value =
      kind === "name" || kind === "service"
        ? workload.service
        : kind === "namespace"
          ? workload.namespace
          : kind === "label"
            ? workload.labels[key]
            : kind === "annotation"
              ? workload.annotations[key]
              : whole
    if (value === undefined) missing = true
    return value ?? ""
  })
  return missing ? undefined : filled
}

/** A template's every string filled; a field whose value names what the found thing lacks is left out. */
export const filled = (value: unknown, workload: Values): unknown => {
  if (typeof value === "string") return fill(value, workload)
  if (Array.isArray(value)) return value.map((each) => filled(each, workload)).filter((each) => each !== undefined)
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, each]) => {
        const done = filled(each, workload)
        return done === undefined ? [] : [[key, done]]
      }),
    )
  return value
}

const annotated = ["description", "owner", "repository", "runbook"] as const

/** The entry a workload in `environment` becomes, before it is checked as a written one is. */
export const entryOf = (rule: DiscoverRule, environment: string, workload: Workload): unknown => ({
  ...(filled(rule.service ?? {}, valuesOf(workload)) as object),
  ...Object.fromEntries(
    annotated.flatMap((field) => {
      const value = workload.annotations[`estate.dev/${field}`]
      return value === undefined ? [] : [[field, value]]
    }),
  ),
  name: serviceName(workload),
  environments: [environment],
  kubernetes: { namespace: workload.namespace, workloads: [{ kind: workload.kind, name: workload.name }] },
  discovered: { from: "kubernetes" },
})

/** Entries of one name, found in several environments, as one service in each; its first namespace kept. */
export const together = (entries: ReadonlyArray<Service>): ReadonlyArray<Service> => {
  const byName = new Map<string, Service>()
  for (const entry of entries) {
    const was = byName.get(entry.name)
    if (was === undefined) {
      byName.set(entry.name, entry)
      continue
    }
    const kubernetes = was.kubernetes
    const workloads =
      kubernetes === undefined || entry.kubernetes?.namespace !== kubernetes.namespace
        ? kubernetes?.workloads
        : [
            ...kubernetes.workloads,
            ...(entry.kubernetes?.workloads ?? []).filter(
              (each) => !kubernetes.workloads.some((had) => had.kind === each.kind && had.name === each.name),
            ),
          ]
    byName.set(entry.name, {
      ...was,
      environments: [...new Set([...was.environments, ...entry.environments])],
      ...(kubernetes === undefined || workloads === undefined ? {} : { kubernetes: { ...kubernetes, workloads } }),
    })
  }
  return [...byName.values()]
}
