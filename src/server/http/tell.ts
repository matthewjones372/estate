/**
 * `POST /api/alerts/:id/tell?env=`: tells the team that owns an alert's service, in its Slack channel, once a firing.
 * After that the card links to the thread, and the firing's notes, silences and end follow in it.
 */
import { Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import type { Alert } from "../../shared/events"
import { Notes } from "../notes"
import { Configured } from "../settings"
import { channelOf, permalink, post } from "../sources/slack"
import { Estate, updateEstate } from "../state"
import { alertsView } from "../views/alerts"
import { EnvParam, json, refused, searchParams, writer } from "./routes"

const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`)

/** The first message: what fires, what it means, whether it fired before, and who posted it from where. */
const toldText = (alert: Alert, environment: string, by: string, page: string | undefined): string =>
  [
    `${alert.severity === "critical" ? "🔴" : "🔶"} *${alert.name}* is firing in ${environment}${alert.summary === undefined ? "" : `: ${alert.summary}`}`,
    ...(alert.impact === undefined ? [] : [`Impact: ${alert.impact.text}`]),
    ...(alert.history?.[0] === undefined
      ? []
      : [`Fired before: ${times(alert.history.length)}, last ${alert.history[0].startsAt.slice(0, 10)}.`]),
    `Posted by ${by} from Estate${page === undefined ? "" : ` · ${page}`}`,
  ].join("\n")

export const tellRoute = HttpRouter.add(
  "POST",
  "/api/alerts/:id/tell",
  Effect.gen(function* () {
    const person = yield* writer
    const settings = yield* Configured
    if (settings.readOnly === true) return json({ message: "read-only Estate posts nothing" }, 403)
    const slack = settings.slack
    if (slack === undefined) return json({ message: "Estate has no Slack token" }, 404)
    const { id = "" } = yield* HttpRouter.params
    const { env: asked } = yield* searchParams(EnvParam, "env names an environment")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    const alert = alertsView(estate, environment, false).alerts.find((each) => each.id === id)
    if (alert === undefined) return json({ message: `there is no alert ${id} in ${environment}` }, 404)
    if (alert.thread !== undefined) return json(alert.thread)
    const owner = estate.catalog.services.find((each) => each.name === alert.service)?.owner
    const team = estate.catalog.teams?.find((each) => each.name === owner)
    const channel = channelOf(team?.links?.["slack"])
    if (channel === undefined)
      return json({ message: `${alert.service ?? alert.name} has no team with a Slack channel to tell` }, 404)
    const publicUrl = settings.auth.oidc?.publicUrl
    const page =
      publicUrl === undefined
        ? undefined
        : `${publicUrl.replace(/\/$/, "")}/alerts/${encodeURIComponent(alert.id)}?env=${encodeURIComponent(environment)}`
    const told = yield* Effect.result(
      Effect.gen(function* () {
        const sent = yield* post(slack, channel, toldText(alert, environment, person.name, page))
        const url = yield* permalink(slack, sent.channel, sent.ts)
        return { environment, alert: alert.id, startsAt: alert.startsAt, channel: sent.channel, ts: sent.ts, url }
      }),
    )
    if (told._tag === "Failure") return json({ message: told.failure.message }, 502)
    const thread = told.success
    yield* (yield* Notes)
      .keepThread(thread)
      .pipe(Effect.catch((failure) => Effect.logWarning(`a thread could not be kept: ${failure.message}`)))
    yield* updateEstate((now) => ({ ...now, threads: [...(now.threads ?? []), thread] }))
    return json({ url: thread.url })
  }).pipe(Effect.catchTag("Refusal", refused)),
)
