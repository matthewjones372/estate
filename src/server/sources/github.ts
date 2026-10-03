/**
 * Builds from GitHub Actions: each service's workflow runs on its branch, newest first. Asked with the ETag of the last
 * answer, so a quiet repository costs a 304 and nothing of the rate limit.
 */
import { Effect, Redacted, Schema } from "effect"
import { type Service, workflowOf } from "../../shared/catalog"
import type { Build } from "../../shared/events"
import { Remote } from "../remote"
import type { Remembered } from "./remembered"
import { shown } from "./remembered"
import { type Failure, SourceFailure } from "./run"

const Runs = Schema.Struct({
  workflow_runs: Schema.Array(
    Schema.Struct({
      head_sha: Schema.String,
      display_title: Schema.String,
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      updated_at: Schema.String,
      html_url: Schema.String,
    }),
  ),
})
type Run = (typeof Runs.Type)["workflow_runs"][number]

export const statusOf = (run: Pick<Run, "status" | "conclusion">): Build["status"] => {
  if (run.status !== "completed") return run.status === "in_progress" ? "running" : "queued"
  if (run.conclusion === "success") return "success"
  return run.conclusion === "cancelled" || run.conclusion === "skipped" ? "cancelled" : "failure"
}

export interface GitHub {
  readonly url?: string
  readonly token?: Redacted.Redacted<string>
}

/** A service's builds, or what it last had when GitHub says nothing changed. */
export const githubBuilds = (
  github: GitHub,
  service: Service,
  remembered: Map<string, Remembered>,
): Effect.Effect<ReadonlyArray<Build>, Failure, Remote> => {
  const repository = service.repository?.replace(/^github:/, "")
  const workflow = workflowOf(service)?.workflow
  if (repository === undefined || workflow === undefined) return Effect.succeed([])
  const branch = encodeURIComponent(workflowOf(service)?.branch ?? "main")
  const url = `${(github.url ?? "https://api.github.com").replace(/\/$/, "")}/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${branch}&per_page=${shown}`
  const last = remembered.get(url)
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "estate",
    ...(github.token === undefined ? {} : { authorization: `Bearer ${Redacted.value(github.token)}` }),
    ...(last === undefined ? {} : { "if-none-match": last.etag }),
  }
  return Effect.gen(function* () {
    const remote = yield* Remote
    const answered = yield* remote
      .call({ url, headers })
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `GitHub ${error.message}` })))
    if (answered.status === 304 && last !== undefined) return last.builds
    if (answered.status !== 200)
      return yield* new SourceFailure({
        message: `GitHub answered ${answered.status} for ${repository}: ${answered.text.slice(0, 160)}`,
      })
    const runs = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Runs))(answered.text).pipe(
      Effect.mapError(
        () => new SourceFailure({ message: `GitHub answered ${repository}'s runs in a shape Estate does not know` }),
      ),
    )
    const builds = runs.workflow_runs.map((run) => ({
      sha: run.head_sha,
      title: run.display_title,
      status: statusOf(run),
      at: run.updated_at,
      url: run.html_url,
    }))
    const { etag } = answered.headers
    if (etag !== undefined) remembered.set(url, { etag, builds })
    return builds
  })
}
