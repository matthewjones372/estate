/**
 * Builds from TeamCity: a build type's last ten builds on a branch, queued, running or finished, each with the
 * revision it built and that change's comment, through the REST API with an access token.
 */
import { Effect, Redacted, Schema } from "effect"
import { type Service, teamcityOf } from "../../shared/catalog"
import type { Build } from "../../shared/events"
import { callJson, type Remote } from "../remote"
import { epoch } from "../time"
import { type Failure, SourceFailure } from "./run"

export interface TeamCity {
  readonly url: string
  readonly token?: Redacted.Redacted<string>
}

const Builds = Schema.Struct({
  build: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        number: Schema.optionalKey(Schema.String),
        status: Schema.optionalKey(Schema.String),
        state: Schema.String,
        webUrl: Schema.String,
        queuedDate: Schema.optionalKey(Schema.String),
        startDate: Schema.optionalKey(Schema.String),
        finishDate: Schema.optionalKey(Schema.String),
        revisions: Schema.optionalKey(
          Schema.Struct({ revision: Schema.optionalKey(Schema.Array(Schema.Struct({ version: Schema.String }))) }),
        ),
        changes: Schema.optionalKey(
          Schema.Struct({
            change: Schema.optionalKey(
              Schema.Array(Schema.Struct({ version: Schema.String, comment: Schema.optionalKey(Schema.String) })),
            ),
          }),
        ),
      }),
    ),
  ),
})

const fields =
  "build(number,status,state,webUrl,queuedDate,startDate,finishDate,revisions(revision(version)),changes(change(version,comment)))"

/** TeamCity's `20261003T114500+0000` as an instant. */
export const instantOf = (written: string | undefined): string => {
  const parts = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)([+-]\d\d)(\d\d)$/.exec(written ?? "")
  if (parts === null) return epoch
  const [, year, month, day, hours, minutes, seconds, zone, zoneMinutes] = parts
  return new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}${zone}:${zoneMinutes}`).toISOString()
}

const statusOf = (state: string, status: string | undefined): Build["status"] => {
  if (state === "queued") return "queued"
  if (state === "running") return "running"
  return status === "SUCCESS" ? "success" : status === "FAILURE" ? "failure" : "cancelled"
}

/** A service's builds, newest first, or nothing if its catalog entry names no TeamCity build type. */
export const teamcityBuilds = (
  teamcity: TeamCity,
  service: Service,
): Effect.Effect<ReadonlyArray<Build>, Failure, Remote> => {
  const named = teamcityOf(service)
  if (named === undefined) return Effect.succeed([])
  const locator = [
    `buildType:(id:${named.buildType})`,
    ...(named.branch === undefined ? [] : [`branch:(name:${named.branch})`]),
    "state:any",
    "canceled:any",
    "count:10",
  ].join(",")
  const query = new URLSearchParams({ locator, fields })
  return callJson({
    url: `${teamcity.url.replace(/\/$/, "")}/app/rest/builds?${query}`,
    headers: {
      accept: "application/json",
      ...(teamcity.token === undefined ? {} : { authorization: `Bearer ${Redacted.value(teamcity.token)}` }),
    },
  }).pipe(
    Effect.mapError(
      (error) =>
        new SourceFailure({
          message: `TeamCity ${error.message.replace(/^answered (\d+)/, `answered $1 for ${named.buildType}`)}`,
        }),
    ),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Builds)(body).pipe(
        Effect.mapError(
          () =>
            new SourceFailure({
              message: `TeamCity answered ${named.buildType}'s builds in a shape Estate does not know`,
            }),
        ),
      ),
    ),
    Effect.map((found) =>
      (found.build ?? []).map((build): Build => {
        const sha = build.revisions?.revision?.[0]?.version ?? ""
        const change = build.changes?.change?.find((each) => each.version === sha)
        return {
          sha,
          title: change?.comment?.split("\n")[0]?.trim() || `#${build.number ?? "?"}`,
          status: statusOf(build.state, build.status),
          at: instantOf(build.finishDate ?? build.startDate ?? build.queuedDate),
          url: build.webUrl,
        }
      }),
    ),
  )
}
