/**
 * A service's lines, read from its environment's Loki or Elasticsearch, or else from its pods' own logs through the
 * cluster's API, masked as the catalog says before they go anywhere.
 */
import { Effect, type FileSystem, Schema } from "effect"
import { kubernetesOf, type Service } from "../../shared/catalog"
import { Remote } from "../remote"
import type { Sources } from "../settings"
import { iso } from "../time"
import { podsOf } from "./cluster"
import { elasticLines } from "./elastic"
import { lokiOf, type Reach } from "./grafana"
import { type Cluster, clusterOf } from "./kubernetes"
import { errorTest, type Line, lineOf, masking } from "./lines"
import { type Failure, SourceFailure } from "./run"

const LokiStreams = Schema.Struct({
  data: Schema.Struct({
    result: Schema.Array(
      Schema.Struct({
        stream: Schema.Record(Schema.String, Schema.String),
        values: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
      }),
    ),
  }),
})
const decodeStreams = Schema.decodeUnknownEffect(Schema.fromJsonString(LokiStreams))

/** Loki's times are nanoseconds, written out so that they keep their precision. */
const nanos = (millis: number) => `${Math.floor(millis)}000000`

const lokiLines = (
  loki: Reach,
  selector: string,
  from: number,
  to: number,
  limit: number,
): Effect.Effect<ReadonlyArray<Line>, Failure, Remote> =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const query = new URLSearchParams({
      query: selector,
      start: nanos(from),
      end: nanos(to),
      limit: String(limit),
      // The newest lines in the window, so that a busy service skips its older lines rather than its latest.
      direction: "backward",
    })
    const answered = yield* remote
      .call({
        url: `${loki.url}/loki/api/v1/query_range?${query}`,
        headers: loki.headers,
      })
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `Loki ${error.message}` })))
    if (answered.status !== 200)
      return yield* new SourceFailure({ message: `Loki answered ${answered.status}: ${answered.text.slice(0, 200)}` })
    const streams = yield* decodeStreams(answered.text).pipe(
      Effect.mapError(() => new SourceFailure({ message: "Loki answered in a shape Estate does not know" })),
    )
    return streams.data.result
      .flatMap((stream) =>
        stream.values.map(([at, text]) =>
          lineOf(iso(Number(at.slice(0, -6))), text, stream.stream["pod"] ?? stream.stream["instance"]),
        ),
      )
      .sort((a, b) => a.at.localeCompare(b.at))
  })

/** A pod log line, as the cluster writes it with timestamps: the time, a space, and the line. */
const podLine =
  (pod: string) =>
  (written: string): Line | undefined => {
    const space = written.indexOf(" ")
    const at = Date.parse(written.slice(0, space).replace(/(\.\d{3})\d+/, "$1"))
    return space < 0 || Number.isNaN(at) ? undefined : lineOf(iso(at), written.slice(space + 1), pod)
  }

const podLines = (
  cluster: Cluster,
  namespace: string,
  pod: string,
  from: number,
  limit: number,
): Effect.Effect<ReadonlyArray<Line>, Failure, Remote> =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const query = new URLSearchParams({ timestamps: "true", tailLines: String(limit), sinceTime: iso(from) })
    const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?${query}`
    const answered = yield* remote
      .call({
        url: `${cluster.url}${path}`,
        headers: cluster.headers,
        ...(cluster.ca === undefined ? {} : { ca: cluster.ca }),
      })
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `the cluster ${error.message}` })))
    if (answered.status !== 200)
      return yield* new SourceFailure({ message: `the cluster answered ${answered.status} for ${pod}'s log` })
    return answered.text.split("\n").flatMap((written) => {
      const line = podLine(pod)(written)
      return line === undefined ? [] : [line]
    })
  })

export interface ServiceLogs {
  /** Where the lines come from, as the page names it. */
  readonly from: "Loki" | "Elasticsearch" | "the cluster"
  /** Lines from `from` to `to` (milliseconds), at most `limit`, oldest first, masked. */
  readonly read: (
    from: number,
    to: number,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<Line>, Failure, Remote | FileSystem.FileSystem>
  readonly isError: (line: Line) => boolean
}

/** A service's lines in an environment, if it has a Loki or Elasticsearch, or a cluster and a namespace to read pods in. */
export const logsFor = (section: Sources, service: Service): ServiceLogs | undefined => {
  const mask = masking(service.logs?.mask)
  const isError = errorTest(service.logs?.errors)
  const namespace = kubernetesOf(service)?.namespace
  const { elasticsearch, kubernetes } = section
  const loki = lokiOf(section)
  if (loki !== undefined) {
    const selector =
      service.logs?.selector ??
      (namespace === undefined ? `{app="${service.name}"}` : `{namespace="${namespace}", app="${service.name}"}`)
    return {
      from: "Loki",
      isError,
      read: (from, to, limit) => Effect.map(lokiLines(loki, selector, from, to, limit), (lines) => lines.map(mask)),
    }
  }
  if (elasticsearch !== undefined)
    return {
      from: "Elasticsearch",
      isError,
      read: (from, to, limit) =>
        Effect.map(elasticLines(elasticsearch, service, from, to, limit), (lines) => lines.map(mask)),
    }
  if (kubernetes === undefined || namespace === undefined) return undefined
  return {
    from: "the cluster",
    isError,
    read: (from, to, limit) =>
      Effect.gen(function* () {
        const cluster = yield* clusterOf(kubernetes)
        const pods = yield* podsOf(cluster, service)
        const read = yield* Effect.forEach(pods, (pod) => podLines(cluster, namespace, pod.name, from, limit), {
          concurrency: 4,
        })
        return read
          .flat()
          .filter((line) => line.at <= iso(to))
          .sort((a, b) => a.at.localeCompare(b.at))
          .slice(-limit)
          .map(mask)
      }),
  }
}
