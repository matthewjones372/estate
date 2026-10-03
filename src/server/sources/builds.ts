/** Every service's builds, from the tool its catalog entry names: GitHub Actions, GitLab CI, Jenkins, TeamCity or Harness CI. */
import { type Duration, Effect, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import type { Build } from "../../shared/events"
import type { Remote } from "../remote"
import { forEver } from "../schedule"
import type { Settings } from "../settings"
import { Estate, updateEstate } from "../state"
import { isoNow } from "../time"
import { githubBuilds } from "./github"
import { gitlabBuilds } from "./gitlab"
import { harnessBuilds } from "./harness"
import { jenkinsBuilds } from "./jenkins"
import type { Remembered } from "./remembered"
import { afterRead, type Failure } from "./run"
import { teamcityBuilds } from "./teamcity"

type Tools = NonNullable<Settings["builds"]>

const buildsOf = (
  tools: Tools,
  service: Service,
  remembered: Map<string, Remembered>,
): Effect.Effect<ReadonlyArray<Build>, Failure, Remote> => {
  const { build } = service
  if (build === undefined) return Effect.succeed([])
  if ("gitlab" in build)
    return tools.gitlab === undefined ? Effect.succeed([]) : gitlabBuilds(tools.gitlab, service, remembered)
  if ("jenkins" in build)
    return tools.jenkins === undefined ? Effect.succeed([]) : jenkinsBuilds(tools.jenkins, service)
  if ("harness" in build)
    return tools.harness === undefined ? Effect.succeed([]) : harnessBuilds(tools.harness, service)
  if ("teamcity" in build)
    return tools.teamcity === undefined ? Effect.succeed([]) : teamcityBuilds(tools.teamcity, service)
  return tools.github === undefined ? Effect.succeed([]) : githubBuilds(tools.github, service, remembered)
}

/** Every service's builds, by its name, read once. */
export const readBuilds = (
  tools: Tools,
  services: ReadonlyArray<Service>,
  remembered: Map<string, Remembered> = new Map(),
): Effect.Effect<ReadonlyArray<readonly [string, ReadonlyArray<Build>]>, Failure, Remote> =>
  Effect.forEach(
    services,
    (service) => buildsOf(tools, service, remembered).pipe(Effect.map((builds) => [service.name, builds] as const)),
    { concurrency: 4 },
  )

/** Every service's builds, read now and every minute into the estate. */
export const runBuilds = (
  tools: Tools,
  every: Duration.Input = "60 seconds",
): Effect.Effect<never, never, Estate | Remote> => {
  const remembered = new Map<string, Remembered>()
  const once = Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const read = yield* Effect.result(readBuilds(tools, catalog.services, remembered))
    const at = yield* isoNow
    yield* updateEstate((estate) => ({
      ...estate,
      builds: afterRead(
        estate.builds,
        read._tag === "Success" ? { value: Object.fromEntries(read.success) } : read.failure,
        at,
      ),
    }))
  })
  return forEver(once, every)
}
