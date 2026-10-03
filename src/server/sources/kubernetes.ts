/** A cluster's API: where it is and how Estate signs in to it, from inside the cluster or from settings. */
import { Config, Effect, type FileSystem, Option, Redacted, Schema } from "effect"
import { readText } from "../platform"
import { callJson, type Remote, type RemoteError } from "../remote"
import type { Kubernetes } from "../settings"
import { type Failure, SourceFailure } from "./run"

export interface Cluster {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly ca?: string
}

const serviceAccount = "/var/run/secrets/kubernetes.io/serviceaccount"

const readFile = (path: string): Effect.Effect<string, Failure, FileSystem.FileSystem> =>
  readText(path).pipe(Effect.mapError(() => new SourceFailure({ message: `cannot read ${path}` })))

/** The cluster to read: the one Estate runs in, unless the settings name another. */
/** Where the cluster Estate runs in is, as Kubernetes tells every pod. */
const inClusterHost = Config.option(Config.String("KUBERNETES_SERVICE_HOST"))
const inClusterPort = Config.String("KUBERNETES_SERVICE_PORT").pipe(Config.withDefault("443"))

export const clusterOf = (settings: Kubernetes): Effect.Effect<Cluster, Failure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const KUBERNETES_SERVICE_HOST = Option.getOrUndefined(yield* inClusterHost.pipe(Effect.orElseSucceed(Option.none)))
    const KUBERNETES_SERVICE_PORT = yield* inClusterPort.pipe(Effect.orElseSucceed(() => "443"))
    const inside = settings.inCluster === true || settings.url === undefined
    if (inside && KUBERNETES_SERVICE_HOST === undefined)
      return yield* new SourceFailure({ message: "Estate is not in a cluster, and no url is set" })
    const url = inside ? `https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT}` : (settings.url ?? "")
    const token = inside
      ? yield* readFile(`${serviceAccount}/token`)
      : settings.token === undefined
        ? undefined
        : Redacted.value(settings.token)
    const caFile = inside ? `${serviceAccount}/ca.crt` : settings.caFile
    const ca = caFile === undefined ? undefined : yield* readFile(caFile)
    return {
      url: url.replace(/\/$/, ""),
      headers: token === undefined ? {} : { authorization: `Bearer ${token.trim()}` },
      ...(ca === undefined ? {} : { ca }),
    }
  })

const get = (cluster: Cluster, path: string) =>
  callJson({
    url: `${cluster.url}${path}`,
    headers: cluster.headers,
    ...(cluster.ca === undefined ? {} : { ca: cluster.ca }),
  })

const decodedAs =
  <S extends Schema.Decoder<unknown>>(path: string, schema: S) =>
  (body: unknown): Effect.Effect<S["Type"], Failure> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(
        () => new SourceFailure({ message: `the cluster answered ${path} in a shape Estate does not know` }),
      ),
    )

const inClusterWords = (error: RemoteError): Failure => new SourceFailure({ message: `the cluster ${error.message}` })

/** A GET of the cluster's API, decoded; a failure in the words the cluster used. */
export const kube = <S extends Schema.Decoder<unknown>>(
  cluster: Cluster,
  path: string,
  schema: S,
): Effect.Effect<S["Type"], Failure, Remote> =>
  get(cluster, path).pipe(Effect.mapError(inClusterWords), Effect.flatMap(decodedAs(path, schema)))

/** As `kube`, but an object the cluster does not have is none, for the one service that names it to say so. */
export const kubeIfThere = <S extends Schema.Decoder<unknown>>(
  cluster: Cluster,
  path: string,
  schema: S,
): Effect.Effect<Option.Option<S["Type"]>, Failure, Remote> =>
  Effect.gen(function* () {
    const body = yield* get(cluster, path).pipe(
      Effect.map(Option.some<unknown>),
      Effect.catchIf(
        (error) => error.status === 404,
        () => Effect.succeed(Option.none<unknown>()),
      ),
      Effect.mapError(inClusterWords),
    )
    return Option.isNone(body) ? Option.none() : Option.some(yield* decodedAs(path, schema)(body.value))
  })

export const Condition = Schema.Struct({
  type: Schema.String,
  status: Schema.String,
  reason: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
  lastTransitionTime: Schema.optionalKey(Schema.String),
})

export const Metadata = Schema.Struct({
  name: Schema.String,
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})
