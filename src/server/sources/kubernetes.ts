/** A cluster's API: where it is and how Estate signs in to it, from inside the cluster or from settings. */
import { Effect, Schema } from "effect"
import { callJson, type Remote } from "../remote"
import type { Kubernetes } from "../settings"
import type { Failure } from "./run"

export interface Cluster {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly ca?: string
}

const serviceAccount = "/var/run/secrets/kubernetes.io/serviceaccount"

const readFile = (path: string): Effect.Effect<string, Failure> =>
  Effect.tryPromise({ try: () => Bun.file(path).text(), catch: () => ({ message: `cannot read ${path}` }) })

/** The cluster to read: the one Estate runs in, unless the settings name another. */
export const clusterOf = (
  settings: Kubernetes,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<Cluster, Failure> =>
  Effect.gen(function* () {
    const { KUBERNETES_SERVICE_HOST, KUBERNETES_SERVICE_PORT = "443" } = environment
    const inside = settings.inCluster === true || settings.url === undefined
    if (inside && KUBERNETES_SERVICE_HOST === undefined)
      return yield* Effect.fail({ message: "Estate is not in a cluster, and no url is set" })
    const url = inside ? `https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}` : (settings.url ?? "")
    const token = inside ? yield* readFile(`${serviceAccount}/token`) : settings.token
    const caFile = inside ? `${serviceAccount}/ca.crt` : settings.caFile
    const ca = caFile === undefined ? undefined : yield* readFile(caFile)
    return {
      url: url.replace(/\/$/, ""),
      headers: token === undefined ? {} : { authorization: `Bearer ${token.trim()}` },
      ...(ca === undefined ? {} : { ca }),
    }
  })

/** A GET of the cluster's API, decoded; a failure in the words the cluster used. */
export const kube = <S extends Schema.Decoder<unknown>>(
  cluster: Cluster,
  path: string,
  schema: S,
): Effect.Effect<S["Type"], Failure, Remote> =>
  callJson({
    url: `${cluster.url}${path}`,
    headers: cluster.headers,
    ...(cluster.ca === undefined ? {} : { ca: cluster.ca }),
  }).pipe(
    Effect.mapError((error) => ({ message: `the cluster ${error.message}` })),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() => ({ message: `the cluster answered ${path} in a shape Estate does not know` })),
      ),
    ),
  )

export const Condition = Schema.Struct({
  type: Schema.String,
  status: Schema.String,
  reason: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  lastTransitionTime: Schema.optionalKey(Schema.String),
})

export const Metadata = Schema.Struct({
  name: Schema.String,
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
