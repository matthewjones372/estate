/** A small estate for tests: two environments, four services, and a server answering from stubs. */
import { Effect, Layer, Redacted } from "effect"
import { HttpRouter } from "effect/http"
import type { Catalog } from "../shared/catalog"
import { application, type Started, services } from "./app"
import { memoryNotes, type Notes } from "./notes"
import { type Call, type Reply, stubRemote } from "./remote"
import type { Settings } from "./settings"
import { type EnvironmentState, type EstateState, emptyEnvironment, off } from "./state"
import { stubWeb } from "./web"

export const catalog: Catalog = {
  environments: [
    { name: "staging", sources: "staging" },
    { name: "production", title: "Production", sources: "production" },
  ],
  services: [
    {
      name: "storefront",
      environments: ["staging", "production"],
      kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment", name: "storefront" }] },
      links: { logs: "https://logs.example/{env}/{namespace}/{service}" },
      runbook: "https://runbooks.example/storefront",
      debug: { configMap: "storefront-logging", key: "level", levels: ["INFO", "DEBUG"] },
    },
    { name: "orders", environments: ["staging", "production"], kubernetes: { namespace: "orders", workloads: [] } },
    { name: "payments", environments: ["production"] },
    { name: "search", environments: ["staging", "production"] },
  ],
  vitals: [{ title: "Orders", query: "sum(rate(orders_total[1m]))", unit: "/s" }],
  map: {
    nodes: [
      { id: "storefront", service: "storefront" },
      { id: "orders", service: "orders" },
      { id: "payments", service: "payments" },
      { id: "db", title: "Postgres", kind: "store" },
    ],
    edges: [
      { from: "storefront", to: "orders", label: "orders", rate: "sum(rate(x[1m]))" },
      { from: "orders", to: "payments", alert: "PaymentsSlow" },
      { from: "orders", to: "db" },
    ],
  },
}

export const secret = "a-session-secret-of-at-least-32-characters"

export const settings = (auth: Partial<Settings["auth"]> = {}): Settings => ({
  catalog: "catalog.yaml",
  auth: { sessionSecret: Redacted.make(secret), roles: { viewer: ["developers"], operator: ["ops"] }, ...auth },
  sources: { staging: {}, production: {} },
})

export const environment = (state: Partial<EnvironmentState> = {}): EnvironmentState => ({
  ...emptyEnvironment(new Set()),
  ...state,
})

export const estate = (state: Partial<EstateState> = {}): EstateState => ({
  catalog,
  environments: { staging: environment(), production: environment() },
  builds: off,
  notes: [],
  ...state,
})

const started = (configured: Settings, initial: EstateState = estate()): Started => ({
  settings: configured,
  initial,
  catalogText: "",
})

/** The server as a function from request to response, its calls out answered by `answer`. */
export const serverFor = (
  configured: Settings,
  initial: EstateState = estate(),
  answer: (call: Call) => Reply | undefined = () => undefined,
  notes: Layer.Layer<Notes> = memoryNotes,
) => {
  const web = stubWeb("<!doctype html><title>Estate</title>", {
    "main.js": { body: new TextEncoder().encode("run()"), type: "text/javascript" },
  })
  const { handler } = HttpRouter.toWebHandler(application, { disableLogger: true })
  return Effect.scoped(Layer.build(services(started(configured, initial), web, stubRemote(answer), notes))).pipe(
    Effect.map((context) => ({ handler: (request: Request) => handler(request, context), context })),
  )
}

export type Server = Effect.Success<ReturnType<typeof serverFor>>

export interface Answered {
  readonly status: number
  readonly headers: Headers
  readonly text: string
  readonly json: () => unknown
  readonly response: Response
}

/** What the server answers to `request`, its body read. */
export const ask = (server: Server, request: Request): Effect.Effect<Answered> =>
  Effect.promise(() =>
    server.handler(request).then((response) =>
      response
        .clone()
        .text()
        .then((text) => ({
          status: response.status,
          headers: response.headers,
          text,
          json: () => JSON.parse(text),
          response,
        })),
    ),
  )

export const storefront = catalog.services[0] ?? { name: "storefront", environments: [] }
