/**
 * Builds from Jenkins: a job's last ten builds by its folder path, or a multibranch job's branch, each with the commit
 * it built, through the plain JSON API with a user's API token.
 */
import { Effect, Redacted, Schema } from "effect"
import { jenkinsOf, type Service } from "../../shared/catalog"
import type { Build } from "../../shared/events"
import { callJson, type Remote } from "../remote"
import { iso } from "../time"
import { type Failure, SourceFailure } from "./run"

export interface Jenkins {
  readonly url: string
  readonly user?: string
  readonly token?: Redacted.Redacted<string>
}

const Builds = Schema.Struct({
  builds: Schema.Array(
    Schema.Struct({
      number: Schema.Number,
      result: Schema.optionalKey(Schema.NullOr(Schema.String)),
      inProgress: Schema.optionalKey(Schema.Boolean),
      timestamp: Schema.Number,
      duration: Schema.optionalKey(Schema.Number),
      url: Schema.String,
      actions: Schema.optionalKey(
        Schema.Array(
          Schema.NullOr(
            Schema.Struct({ lastBuiltRevision: Schema.optionalKey(Schema.Struct({ SHA1: Schema.String })) }),
          ),
        ),
      ),
      changeSets: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({ items: Schema.Array(Schema.Struct({ commitId: Schema.String, msg: Schema.String })) }),
        ),
      ),
    }),
  ),
})

const statuses: Readonly<Record<string, Build["status"]>> = {
  SUCCESS: "success",
  FAILURE: "failure",
  UNSTABLE: "failure",
  ABORTED: "cancelled",
  NOT_BUILT: "cancelled",
}

const fields =
  "builds[number,result,inProgress,timestamp,duration,url,actions[lastBuiltRevision[SHA1]],changeSets[items[commitId,msg]]]{0,10}"

/** The path of a job in its folders, and of its branch's job when it is a multibranch pipeline. */
export const jobPath = (job: string, branch?: string) =>
  [...job.split("/"), ...(branch === undefined ? [] : [branch])]
    .map((part) => `/job/${encodeURIComponent(part)}`)
    .join("")

/** A service's builds, newest first, or nothing if its catalog entry names no Jenkins job. */
export const jenkinsBuilds = (
  jenkins: Jenkins,
  service: Service,
): Effect.Effect<ReadonlyArray<Build>, Failure, Remote> => {
  const job = jenkinsOf(service)
  if (job === undefined) return Effect.succeed([])
  const signed =
    jenkins.user === undefined || jenkins.token === undefined
      ? {}
      : { authorization: `Basic ${btoa(`${jenkins.user}:${Redacted.value(jenkins.token)}`)}` }
  const url = `${jenkins.url.replace(/\/$/, "")}${jobPath(job.job, job.branch)}/api/json?tree=${encodeURIComponent(fields)}`
  const named = job.branch === undefined ? job.job : `${job.job} ${job.branch}`
  return callJson({ url, headers: signed }).pipe(
    Effect.mapError(
      (error) =>
        new SourceFailure({
          message: `Jenkins ${error.message.replace(/^answered (\d+)/, `answered $1 for ${named}`)}`,
        }),
    ),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Builds)(body).pipe(
        Effect.mapError(
          () => new SourceFailure({ message: `Jenkins answered ${named}'s builds in a shape Estate does not know` }),
        ),
      ),
    ),
    Effect.map(({ builds }) =>
      builds.map((build): Build => {
        const sha =
          build.actions?.find((action) => action?.lastBuiltRevision !== undefined)?.lastBuiltRevision?.SHA1 ?? ""
        const commit = build.changeSets?.flatMap((set) => set.items).find((item) => item.commitId === sha)
        const running = build.inProgress === true || build.result === null || build.result === undefined
        return {
          sha,
          title: commit?.msg.split("\n")[0] ?? `#${build.number}`,
          status: running
            ? build.inProgress === false
              ? "queued"
              : "running"
            : (statuses[build.result ?? ""] ?? "queued"),
          at: iso(build.timestamp + (running ? 0 : (build.duration ?? 0))),
          url: build.url,
        }
      }),
    ),
  )
}
