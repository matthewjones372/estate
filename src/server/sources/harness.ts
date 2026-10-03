/**
 * Harness, through its NextGen API with an API key: a CI pipeline's executions as a service's builds, and a CD
 * pipeline's executions as what it last deployed to each environment, its failure in Harness's words as the stall.
 */
import { Effect, Redacted, Schema } from "effect"
import { harnessBuildOf, harnessDeployOf, type Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Build } from "../../shared/events"
import { callJson, type Remote } from "../remote"
import type { Chosen } from "../state"
import { iso } from "../time"
import { type Failure, SourceFailure } from "./run"

export interface Harness {
  readonly url?: string
  readonly account: string
  readonly apiKey: Redacted.Redacted<string>
}

interface Pipeline {
  readonly org: string
  readonly project: string
  readonly pipeline: string
}

const Execution = Schema.Struct({
  planExecutionId: Schema.String,
  runSequence: Schema.optionalKey(Schema.Number),
  status: Schema.String,
  startTs: Schema.optionalKey(Schema.Number),
  endTs: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  failureInfo: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: Schema.optionalKey(Schema.String) }))),
  moduleInfo: Schema.optionalKey(
    Schema.Struct({
      ci: Schema.optionalKey(
        Schema.Struct({
          ciExecutionInfoDTO: Schema.optionalKey(
            Schema.Struct({
              branch: Schema.optionalKey(
                Schema.Struct({
                  commits: Schema.optionalKey(
                    Schema.Array(Schema.Struct({ id: Schema.String, message: Schema.String })),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
      cd: Schema.optionalKey(
        Schema.Struct({
          envIdentifiers: Schema.optionalKey(Schema.Array(Schema.String)),
          serviceInfoList: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                identifier: Schema.String,
                artifacts: Schema.optionalKey(
                  Schema.Struct({
                    primary: Schema.optionalKey(Schema.Struct({ tag: Schema.optionalKey(Schema.String) })),
                  }),
                ),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
})
type Execution = typeof Execution.Type

const Summary = Schema.Struct({ data: Schema.Struct({ content: Schema.Array(Execution) }) })

const base = (harness: Harness) => (harness.url ?? "https://app.harness.io").replace(/\/$/, "")

/** A pipeline's newest executions, newest first. */
const executions = (
  harness: Harness,
  pipeline: Pipeline,
  size: number,
): Effect.Effect<ReadonlyArray<Execution>, Failure, Remote> => {
  const query = new URLSearchParams({
    accountIdentifier: harness.account,
    orgIdentifier: pipeline.org,
    projectIdentifier: pipeline.project,
    pipelineIdentifier: pipeline.pipeline,
    page: "0",
    size: String(size),
  })
  return callJson({
    url: `${base(harness)}/pipeline/api/pipelines/execution/summary?${query}`,
    method: "POST",
    headers: { "x-api-key": Redacted.value(harness.apiKey), "content-type": "application/json" },
    body: JSON.stringify({ filterType: "PipelineExecution" }),
  }).pipe(
    Effect.mapError(
      (error) =>
        new SourceFailure({
          message: `Harness ${error.message.replace(/^answered (\d+)/, `answered $1 for ${pipeline.pipeline}`)}`,
        }),
    ),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Summary)(body).pipe(
        Effect.mapError(
          () =>
            new SourceFailure({
              message: `Harness answered ${pipeline.pipeline}'s executions in a shape Estate does not know`,
            }),
        ),
      ),
    ),
    Effect.map((summary) => summary.data.content),
  )
}

const statuses: Readonly<Record<string, Build["status"]>> = {
  Success: "success",
  IgnoreFailed: "success",
  Failed: "failure",
  Errored: "failure",
  Expired: "failure",
  ApprovalRejected: "failure",
  Aborted: "cancelled",
  AbortedByFreeze: "cancelled",
  Queued: "queued",
  NotStarted: "queued",
}

/** Harness's status in Estate's words; any of its many kinds of waiting is running. */
export const statusOf = (status: string): Build["status"] => statuses[status] ?? "running"

const pageOf = (harness: Harness, module: "ci" | "cd", pipeline: Pipeline, execution: Execution) =>
  `${base(harness)}/ng/account/${harness.account}/module/${module}/orgs/${pipeline.org}/projects/${pipeline.project}/pipelines/${pipeline.pipeline}/executions/${execution.planExecutionId}/pipeline`

/** A service's builds from its CI pipeline, newest first, or nothing if its catalog entry names none. */
export const harnessBuilds = (
  harness: Harness,
  service: Service,
): Effect.Effect<ReadonlyArray<Build>, Failure, Remote> => {
  const pipeline = harnessBuildOf(service)
  if (pipeline === undefined) return Effect.succeed([])
  return Effect.map(executions(harness, pipeline, 10), (found) =>
    found.map((execution): Build => {
      const commit = execution.moduleInfo?.ci?.ciExecutionInfoDTO?.branch?.commits?.[0]
      return {
        sha: commit?.id ?? "",
        title: commit?.message.split("\n")[0] ?? `#${execution.runSequence ?? execution.planExecutionId}`,
        status: statusOf(execution.status),
        at: iso(execution.endTs ?? execution.startTs ?? 0),
        url: pageOf(harness, "ci", pipeline, execution),
      }
    }),
  )
}

const tagOf = (execution: Execution, service: string) =>
  execution.moduleInfo?.cd?.serviceInfoList?.find((each) => each.identifier === service)?.artifacts?.primary?.tag

/** What the service's CD pipeline last deployed to the environment, and why it is stuck when it is. */
const chosenFor = (found: ReadonlyArray<Execution>, service: string, environment: string): Chosen | undefined => {
  const here = found.filter(
    (execution) =>
      (execution.moduleInfo?.cd?.envIdentifiers ?? []).includes(environment) && tagOf(execution, service) !== undefined,
  )
  const [latest] = here
  if (latest === undefined) return undefined
  const status = statusOf(latest.status)
  const good = here.find((execution) => statusOf(execution.status) === "success")
  return compact({
    version: tagOf(status === "success" ? latest : (good ?? latest), service) ?? "unknown",
    ready: status === "success",
    at: iso(latest.endTs ?? latest.startTs ?? 0),
    stalled: status === "failure" ? (latest.failureInfo?.message ?? "the deployment failed") : undefined,
  })
}

/** What Harness CD chose for each service it deploys to this environment. */
export const readHarnessDeploys = (
  harness: Harness,
  services: ReadonlyArray<Service>,
  environment: string,
): Effect.Effect<Readonly<Record<string, Chosen>>, Failure, Remote> =>
  Effect.map(
    Effect.forEach(
      services.flatMap((service) => {
        const deploy = harnessDeployOf(service)
        return deploy === undefined ? [] : [[service.name, deploy] as const]
      }),
      ([name, deploy]) =>
        Effect.map(executions(harness, deploy, 20), (found) => {
          const chosen = chosenFor(found, deploy.service ?? name, deploy.environment ?? environment)
          return chosen === undefined ? [] : [[name, chosen] as const]
        }),
      { concurrency: 4 },
    ),
    (each) => Object.fromEntries(each.flat()),
  )
