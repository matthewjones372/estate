/**
 * A service's lines, read from its environment's Loki or Elasticsearch, or else from its pods' own logs through the
 * cluster's API, each with what wrote it and its trace, masked as the catalog says before they go anywhere.
 */
import { Effect, type FileSystem, Schema } from "effect"
import { kubernetesOf, type Service } from "../../shared/catalog"
import { Remote } from "../remote"
import type { Sources } from "../settings"
import { iso } from "../time"
import { podsOf } from "./cluster"
import { datadogErrors, datadogLines, datadogPage } from "./datadog-logs"
import { elasticLines, elasticNotErrors } from "./elastic"
import { lokiOf, type Reach } from "./grafana"
import { type Cluster, clusterOf } from "./kubernetes"
import { defaultErrors, errorTest, fieldsOf, type Line, lineOf, masking } from "./lines"
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
  fields: ReturnType<typeof fieldsOf>,
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
          fields(
            lineOf(iso(Number(at.slice(0, -6))), text, stream.stream["pod"] ?? stream.stream["instance"]),
            stream.stream,
          ),
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
  readonly from: "Loki" | "Elasticsearch" | "Datadog" | "the cluster"
  /** Lines from `from` to `to` (milliseconds), at most `limit`, oldest first, masked. */
  readonly read: (
    from: number,
    to: number,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<Line>, Failure, Remote | FileSystem.FileSystem>
  readonly isError: (line: Line) => boolean
  /**
   * The errors from `from` to `to`, at most `limit`, newest kept: the source is asked for lines that may be errors,
   * and `isError` decides. `capped` when the source had more than were read.
   */
  readonly errors: (
    from: number,
    to: number,
    limit: number,
  ) => Effect.Effect<ErrorsRead, Failure, Remote | FileSystem.FileSystem>
}

export interface ErrorsRead {
  readonly lines: ReadonlyArray<Line>
  readonly capped: boolean
}

type Read = (
  from: number,
  to: number,
  limit: number,
) => Effect.Effect<ReadonlyArray<Line>, Failure, Remote | FileSystem.FileSystem>

/** Errors from a read of the lines that may be errors, which reached its limit when it read as many as asked. */
const errorsFrom =
  (sieved: Read, isError: (line: Line) => boolean, mask: (line: Line) => Line, most = Number.POSITIVE_INFINITY) =>
  (from: number, to: number, limit: number) =>
    Effect.map(sieved(from, to, limit), (lines) => ({
      lines: lines.filter(isError).map(mask),
      capped: lines.length >= Math.min(limit, most),
    }))

/** A LogQL line filter for the catalog's pattern, case aside: a superset of the errors, as levels are in the text. */
const lokiSieve = (pattern: string) => ` |~ "(?i)${pattern.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

/** A service's lines in an environment: from Loki, Datadog or Elasticsearch, or else its pods in the cluster. */
export const logsFor = (section: Sources, service: Service): ServiceLogs | undefined => {
  const fields = fieldsOf(service.logs?.fields)
  // Found before masking, so that a mask over the text cannot hide which trace a line is in.
  const masked = masking(service.logs?.mask)
  const finished = (line: Line) => masked(fields(line))
  const isError = errorTest(service.logs?.errors)
  const namespace = kubernetesOf(service)?.namespace
  const { datadog, elasticsearch, kubernetes } = section
  const loki = lokiOf(section)
  if (loki !== undefined) {
    const selector =
      service.logs?.selector ??
      (namespace === undefined ? `{app="${service.name}"}` : `{namespace="${namespace}", app="${service.name}"}`)
    const sieved = `${selector}${lokiSieve(service.logs?.errors ?? defaultErrors)}`
    return {
      from: "Loki",
      isError,
      read: (from, to, limit) =>
        Effect.map(lokiLines(loki, selector, fields, from, to, limit), (lines) => lines.map(finished)),
      errors: errorsFrom((from, to, limit) => lokiLines(loki, sieved, fields, from, to, limit), isError, finished),
    }
  }
  if (datadog !== undefined) {
    const lines: Read = (from, to, limit) => datadogLines(datadog, service, from, to, limit)
    // Every Datadog line has a status, which is its level, so the statuses that are errors find them all.
    const errorStatuses = datadogErrors(service.logs?.errors ?? defaultErrors)
    const sieved: Read = (from, to, limit) => datadogLines(datadog, service, from, to, limit, errorStatuses)
    return {
      from: "Datadog",
      isError,
      read: (from, to, limit) => Effect.map(lines(from, to, limit), (read) => read.map(finished)),
      errors: errorsFrom(sieved, isError, finished, datadogPage),
    }
  }
  if (elasticsearch !== undefined) {
    const lines: Read = (from, to, limit) => elasticLines(elasticsearch, service, from, to, limit)
    const notErrors = elasticNotErrors(service.logs?.errors ?? defaultErrors)
    const sieved: Read = (from, to, limit) => elasticLines(elasticsearch, service, from, to, limit, notErrors)
    return {
      from: "Elasticsearch",
      isError,
      read: (from, to, limit) => Effect.map(lines(from, to, limit), (read) => read.map(finished)),
      errors: errorsFrom(sieved, isError, finished),
    }
  }
  if (kubernetes === undefined || namespace === undefined) return undefined
  const lines: Read = (from, to, limit) =>
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
    })
  return {
    from: "the cluster",
    isError,
    read: (from, to, limit) => Effect.map(lines(from, to, limit), (read) => read.map(finished)),
    errors: errorsFrom(lines, isError, finished),
  }
}
