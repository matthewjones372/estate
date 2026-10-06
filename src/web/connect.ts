/** The browser's side of the wire: the event stream, and the POSTs a person's actions make. */
import { Option, Schema } from "effect"
import { AgentRun } from "../shared/agents"
import { AroundAlert } from "../shared/around"
import { AskAnswer } from "../shared/ask"
import { type EventName, Load } from "../shared/events"
import { ErrorGroups, LogBatch } from "../shared/log-events"
import type { Actions, ErrorWindow, LogHandlers, Range } from "./context"
import type { Open } from "./live"

const decodeRuns = Schema.decodeUnknownOption(Schema.Array(AgentRun))
const decodeAround = Schema.decodeUnknownOption(AroundAlert)
const decodeAsk = Schema.decodeUnknownOption(AskAnswer)
const decodeMessage = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))
const decodeThread = Schema.decodeUnknownOption(Schema.Struct({ url: Schema.String }))

const names: ReadonlyArray<EventName> = ["catalog", "services", "alerts", "deploys", "feed"]

export const openEvents: Open = (environment, handlers) => {
  const source = new EventSource(`/events?env=${encodeURIComponent(environment)}`)
  source.onopen = handlers.onOpen
  source.onerror = handlers.onLost
  source.addEventListener("beat", handlers.onBeat)
  for (const name of names) {
    source.addEventListener(name, (event) => handlers.onEvent(name, (event as MessageEvent<string>).data))
  }
  return () => source.close()
}

const send = (method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<boolean> =>
  fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(
    (response) => response.ok,
    () => false,
  )

const decodeLoad = Schema.decodeUnknownOption(Load)
const decodeBatch = Schema.decodeUnknownOption(Schema.fromJsonString(LogBatch))
const decodeGroups = Schema.decodeUnknownOption(ErrorGroups)

const watchLogs = (environment: string, service: string, handlers: LogHandlers) => {
  const source = new EventSource(`/logs?env=${encodeURIComponent(environment)}&service=${encodeURIComponent(service)}`)
  let opened = false
  source.addEventListener("from", (event) => {
    opened = true
    handlers.from(JSON.parse((event as MessageEvent<string>).data))
  })
  source.addEventListener("lines", (event) =>
    Option.map(decodeBatch((event as MessageEvent<string>).data), handlers.batch),
  )
  // A stream refused before it opened is closed by the browser, not tried again.
  source.onerror = () => {
    if (!opened && source.readyState === EventSource.CLOSED) handlers.missing()
  }
  return () => source.close()
}

const loadFrom = (url: string) =>
  fetch(url)
    .then((response) => (response.ok ? response.json() : undefined))
    .then((body) => Option.getOrUndefined(decodeLoad(body)))
    .catch(() => undefined)

const windowQuery = (window: ErrorWindow) =>
  "range" in window ? `range=${window.range}` : `since=${encodeURIComponent(window.since)}`

export const serverActions = (
  environment: () => string,
  navigation: Pick<Actions, "navigate" | "choose">,
): Actions => ({
  ...navigation,
  addNote: (alert, text) => send("POST", "/api/notes", { environment: environment(), alert, text }),
  setImpact: (alert, text) => send("PUT", `/api/impacts/${encodeURIComponent(alert)}`, { text }),
  removeNote: (note) => send("DELETE", `/api/notes/${encodeURIComponent(note)}`),
  silence: (alert, minutes, reason) =>
    send("POST", "/api/silences", { environment: environment(), alert, minutes, reason }),
  unsilence: (silence) =>
    send("DELETE", `/api/silences/${encodeURIComponent(silence)}?env=${encodeURIComponent(environment())}`),
  debug: (service, minutes) => send("POST", "/api/debug", { environment: environment(), service, minutes }),
  undebug: (service) =>
    send("DELETE", `/api/debug/${encodeURIComponent(service)}?env=${encodeURIComponent(environment())}`),
  watchLogs: (service, handlers) => watchLogs(environment(), service, handlers),
  runs: (agent) =>
    fetch(`/api/agents/runs?env=${encodeURIComponent(environment())}&agent=${encodeURIComponent(agent)}`)
      .then((response): Promise<ReadonlyArray<AgentRun> | "none" | undefined> => {
        if (response.status === 404 || response.status === 403) return Promise.resolve("none")
        if (!response.ok) return Promise.resolve(undefined)
        return response.json().then((body) => Option.getOrUndefined(decodeRuns(body)))
      })
      .catch(() => undefined),
  errors: (service, window) =>
    fetch(
      `/api/logs/errors?env=${encodeURIComponent(environment())}&service=${encodeURIComponent(service)}&${windowQuery(window)}`,
    )
      .then((response): Promise<ErrorGroups | "none" | undefined> => {
        if (response.status === 404 || response.status === 403) return Promise.resolve("none")
        if (!response.ok) return Promise.resolve(undefined)
        return response.json().then((body) => Option.getOrUndefined(decodeGroups(body)))
      })
      .catch(() => undefined),
  load: (service, range: Range) =>
    loadFrom(
      `/api/load?env=${encodeURIComponent(environment())}&service=${encodeURIComponent(service)}&range=${range}`,
    ),
  storeLoad: (store, range: Range) =>
    loadFrom(
      `/api/store-load?env=${encodeURIComponent(environment())}&store=${encodeURIComponent(store)}&range=${range}`,
    ),
  around: (alert) =>
    fetch(`/api/alerts/${encodeURIComponent(alert)}/around?env=${encodeURIComponent(environment())}`)
      .then((response) =>
        response.ok ? response.json().then((body) => Option.getOrUndefined(decodeAround(body))) : undefined,
      )
      .catch(() => undefined),
  askAlert: (alert, signal) => askAlert(environment(), alert, signal),
  tell: (alert) =>
    fetch(`/api/alerts/${encodeURIComponent(alert)}/tell?env=${encodeURIComponent(environment())}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
      .then((response) =>
        response
          .json()
          .then((body) =>
            response.ok
              ? (Option.getOrUndefined(decodeThread(body)) ?? "Slack's link could not be read.")
              : (Option.getOrUndefined(decodeMessage(body))?.message ??
                `Slack could not be told (${response.status}).`),
          ),
      )
      .catch(() => "Estate could not be reached."),
})

/** Why an ask got no answer, in the server's words where it gave them. */
const refusalOf = (response: Response): Promise<string> =>
  response
    .json()
    .then((body) => Option.getOrUndefined(decodeMessage(body))?.message)
    .catch(() => undefined)
    .then((message) => message ?? `Ask AI could not answer (${response.status}).`)

const askAlert = (environment: string, alert: string, signal: AbortSignal): Promise<AskAnswer | string> =>
  fetch(`/api/alerts/${encodeURIComponent(alert)}/ask?env=${encodeURIComponent(environment)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal,
  })
    .then(
      (response): Promise<AskAnswer | string> =>
        response.ok
          ? response
              .json()
              .then(
                (body) => Option.getOrUndefined(decodeAsk(body)) ?? "Ask AI answered in a shape the page cannot read.",
              )
          : refusalOf(response),
    )
    .catch(() => "Ask AI could not be reached.")
