/**
 * Builds from GitLab CI: each service's pipelines on its ref, newest first, titled by their commits, and for a failed
 * one the job that failed. Asked with the ETag of the last answer, so a quiet project costs a 304.
 */
import { Effect, Redacted, Schema } from "effect"
import { pipelinesOf, type Service } from "../../shared/catalog"
import type { Build } from "../../shared/events"
import { callJson, Remote } from "../remote"
import type { Remembered } from "./remembered"
import { shown } from "./remembered"
import { type Failure, SourceFailure } from "./run"

export interface GitLab {
  readonly url?: string
  readonly token?: Redacted.Redacted<string>
}

const Pipelines = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    sha: Schema.String,
    status: Schema.String,
    updated_at: Schema.String,
    web_url: Schema.String,
  }),
)
const Commits = Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String }))
const Jobs = Schema.Array(Schema.Struct({ name: Schema.String }))

export const statusOf = (status: string): Build["status"] => {
  if (status === "success") return "success"
  if (status === "failed") return "failure"
  if (status === "running") return "running"
  return status === "canceled" || status === "skipped" ? "cancelled" : "queued"
}

const failed = (message: string) => () => new SourceFailure({ message })

/** A service's pipelines, or what it last had when GitLab says nothing changed. */
export const gitlabBuilds = (
  gitlab: GitLab,
  service: Service,
  remembered: Map<string, Remembered>,
): Effect.Effect<ReadonlyArray<Build>, Failure, Remote> => {
  const pipelines = pipelinesOf(service)
  if (pipelines === undefined) return Effect.succeed([])
  const api = `${(gitlab.url ?? "https://gitlab.com").replace(/\/$/, "")}/api/v4/projects/${encodeURIComponent(pipelines.project)}`
  const ref = encodeURIComponent(pipelines.ref ?? "main")
  const url = `${api}/pipelines?ref=${ref}&per_page=${shown}`
  const signed = gitlab.token === undefined ? {} : { "private-token": Redacted.value(gitlab.token) }
  const last = remembered.get(url)
  return Effect.gen(function* () {
    const remote = yield* Remote
    const answered = yield* remote
      .call({ url, headers: { ...signed, ...(last === undefined ? {} : { "if-none-match": last.etag }) } })
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `GitLab ${error.message}` })))
    if (answered.status === 304 && last !== undefined) return last.builds
    if (answered.status !== 200)
      return yield* new SourceFailure({
        message: `GitLab answered ${answered.status} for ${pipelines.project}: ${answered.text.slice(0, 160)}`,
      })
    const unknown = failed(`GitLab answered ${pipelines.project}'s pipelines in a shape Estate does not know`)
    const read = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Pipelines))(answered.text).pipe(
      Effect.mapError(unknown),
    )
    const commits = yield* callJson({
      url: `${api}/repository/commits?ref_name=${ref}&per_page=20`,
      headers: signed,
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Commits)),
      Effect.orElseSucceed(() => []),
    )
    const titles = new Map(commits.map((commit) => [commit.id, commit.title]))
    const latest = read[0]
    const job =
      latest?.status === "failed"
        ? yield* callJson({ url: `${api}/pipelines/${latest.id}/jobs?scope[]=failed`, headers: signed }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Jobs)),
            Effect.map((jobs) => jobs[0]?.name),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined
    const builds = read.map((pipeline, index) => ({
      sha: pipeline.sha,
      title: titles.get(pipeline.sha) ?? `pipeline ${pipeline.id}`,
      status: statusOf(pipeline.status),
      at: pipeline.updated_at,
      url: pipeline.web_url,
      ...(index === 0 && job !== undefined ? { job } : {}),
    }))
    const { etag } = answered.headers
    if (etag !== undefined) remembered.set(url, { etag, builds })
    return builds
  })
}
