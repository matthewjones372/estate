import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result } from "effect"
import { type Call, Remote, RemoteError, reply, stubRemote } from "../remote"
import type { Raising } from "./incident-tools"
import { pagerDuty } from "./pagerduty"

const settings = {
  token: Redacted.make("pd-key"),
  from: "estate@example.com",
  service: "PABC123",
}

const raising: Raising = {
  key: "inc-1",
  title: "Chip registry slow",
  impact: "Owners cannot look up a lost pet",
  firings: [
    {
      environment: "production",
      name: "ChipRegistryLatency",
      service: "chip-registry",
      severity: "critical",
      startsAt: "2026-10-12T16:40:00Z",
    },
    { environment: "production", name: "ChipRegistryErrors", severity: "warning", startsAt: "2026-10-12T16:42:00Z" },
  ],
  page: "https://estate.example/incidents/inc-1",
  by: "matt",
}

const made = { id: "Q1ABC", html_url: "https://example.pagerduty.com/incidents/Q1ABC" }

const inPagerDuty = {
  incident: {
    ...made,
    status: "acknowledged",
    urgency: "high",
    priority: { id: "P2ID", summary: "P2" },
    assignments: [{ assignee: { id: "U1", summary: "ada" } }, { assignee: { id: "U2", summary: "gil" } }],
  },
}

const authorised = (call: Call) =>
  call.headers?.["Authorization"] === "Token token=pd-key" &&
  call.headers["Accept"] === "application/vnd.pagerduty+json;version=2"

/** PagerDuty's REST API in the shapes its reference gives, refusing a call without the token. */
const fake = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (!authorised(call)) return reply({ error: { message: "Unauthorized", code: 2006 } }, 401)
  const url = new URL(call.url)
  if (call.method === "POST" && url.pathname === "/incidents") return reply({ incident: made }, 201)
  if (url.pathname === "/incidents/Q1ABC") return reply(inPagerDuty)
  return undefined
}

const run = <A, E>(effect: Effect.Effect<A, E, Remote>, answer: (call: Call) => ReturnType<typeof reply> | undefined) =>
  Effect.runPromise(Effect.result(effect.pipe(Effect.provide(stubRemote(answer)))))

describe("PagerDuty", () => {
  test("raises with the token, From, the incident key, the title, the urgency and a body naming each firing", () => {
    const calls: Call[] = []
    return run(pagerDuty(settings).raise(raising), fake(calls)).then((raised) => {
      expect(raised).toEqual(Result.succeed({ id: "Q1ABC", url: made.html_url }))
      const call = calls[0]
      expect([call?.method, call?.url, call?.headers?.["From"], call?.headers?.["Content-Type"]]).toEqual([
        "POST",
        "https://api.pagerduty.com/incidents",
        "estate@example.com",
        "application/json",
      ])
      const { incident } = JSON.parse(call?.body ?? "{}")
      expect(incident).toEqual({
        type: "incident",
        title: "Chip registry slow",
        service: { id: "PABC123", type: "service_reference" },
        urgency: "high",
        incident_key: "inc-1",
        body: { type: "incident_body", details: expect.any(String) },
      })
      expect(incident.body.details.split("\n")).toEqual([
        "Impact: Owners cannot look up a lost pet",
        "",
        "Firings:",
        "- ChipRegistryLatency in production (chip-registry), since 2026-10-12T16:40:00Z",
        "- ChipRegistryErrors in production, since 2026-10-12T16:42:00Z",
        "",
        "In Estate: https://estate.example/incidents/inc-1",
        "Raised from Estate by matt",
      ])
    })
  })

  test("raises at low urgency when no firing is critical, with a body that needs no impact or page", () => {
    const calls: Call[] = []
    const calm = {
      key: "inc-2",
      title: "Slow",
      firings: [{ environment: "staging", name: "Slow", startsAt: "t" }],
      by: "ada",
    }
    return run(pagerDuty(settings).raise(calm), fake(calls)).then(() => {
      const { incident } = JSON.parse(calls[0]?.body ?? "{}")
      expect(incident.urgency).toBe("low")
      expect(incident.body.details).toBe("Firings:\n- Slow in staging, since t\n\nRaised from Estate by ada")
    })
  })

  test("sends a team's incident to the team's own service, and to a URL the settings name", () => {
    const calls: Call[] = []
    const eu = { ...settings, url: "https://api.eu.pagerduty.com/" }
    return run(pagerDuty(eu).raise({ ...raising, team: { pagerduty: "PDEF456" } }), fake(calls)).then(() => {
      expect(calls[0]?.url).toBe("https://api.eu.pagerduty.com/incidents")
      expect(JSON.parse(calls[0]?.body ?? "{}").incident.service.id).toBe("PDEF456")
    })
  })

  test("reads status, priority and assignees, and urgency where the account has no priorities", () =>
    Promise.all([
      run(pagerDuty(settings).read("Q1ABC"), fake([])),
      run(pagerDuty(settings).read("Q1ABC"), () =>
        reply({ incident: { ...inPagerDuty.incident, priority: null, assignments: [] } }),
      ),
    ]).then(([read, unprioritised]) => {
      expect(read).toEqual(
        Result.succeed({ status: "acknowledged", severity: "P2", responders: ["ada", "gil"], url: made.html_url }),
      )
      expect(unprioritised).toEqual(
        Result.succeed({ status: "acknowledged", severity: "high", responders: [], url: made.html_url }),
      )
    }))

  test("fails with PagerDuty's own message when it refuses", () =>
    run(pagerDuty(settings).raise(raising), (call) =>
      call.method === "POST"
        ? reply({ error: { message: "Invalid Input Provided", code: 2001, errors: ["Service not found"] } }, 400)
        : reply({ incidents: [] }),
    ).then((raised) => {
      expect(Result.isFailure(raised) && raised.failure.message).toBe(
        "PagerDuty answered 400: Invalid Input Provided: Service not found",
      )
    }))

  test("finds by its key an incident it raised whose answer was lost, or that is already open", () => {
    const listed = (call: Call) => {
      const url = new URL(call.url)
      return url.pathname === "/incidents" && url.searchParams.get("incident_key") === "inc-1"
        ? reply({ incidents: [made] })
        : undefined
    }
    const lost = Layer.succeed(Remote)({
      call: (call: Call) =>
        call.method === "POST"
          ? Effect.fail(new RemoteError({ url: call.url, message: "did not answer in 10 s" }))
          : Effect.succeed(listed(call) ?? reply("not found", 404)),
    })
    return Promise.all([
      Effect.runPromise(pagerDuty(settings).raise(raising).pipe(Effect.provide(lost))),
      run(pagerDuty(settings).raise(raising), (call) =>
        call.method === "POST"
          ? reply({ error: { message: "Open incident with key already exists", code: 2001 } }, 400)
          : listed(call),
      ),
    ]).then(([found, open]) => {
      expect(found).toEqual({ id: "Q1ABC", url: made.html_url })
      expect(open).toEqual(Result.succeed({ id: "Q1ABC", url: made.html_url }))
    })
  })

  test("waits out its rate limit once, then says when to try again", () => {
    let posts = 0
    const limited = (times: number) => (call: Call) => {
      if (call.method !== "POST") return reply({ incidents: [] })
      posts += 1
      return posts <= times
        ? reply({ error: { message: "Rate Limit Exceeded" } }, 429, { "ratelimit-reset": "0" })
        : reply({ incident: made }, 201)
    }
    return run(pagerDuty(settings).raise(raising), limited(1))
      .then((once) => {
        expect(once).toEqual(Result.succeed({ id: "Q1ABC", url: made.html_url }))
        posts = 0
        return run(pagerDuty(settings).raise(raising), limited(2))
      })
      .then((twice) => {
        expect(Result.isFailure(twice) && twice.failure.message).toBe(
          "PagerDuty is limiting Estate's calls: try again in 0 s",
        )
      })
  })

  test("says so when it answers in a shape Estate does not know", () =>
    run(pagerDuty(settings).read("Q1ABC"), () => reply({ incident: { id: "Q1ABC" } })).then((read) => {
      expect(Result.isFailure(read) && read.failure.message).toBe("PagerDuty answered in a shape Estate does not know")
    }))

  test("is checked by reading the service it raises in and finding the user it raises as", () => {
    const account = (users: ReadonlyArray<{ readonly email: string; readonly name: string }>) => (call: Call) => {
      if (!authorised(call)) return reply({ error: { message: "Unauthorized" } }, 401)
      const url = new URL(call.url)
      if (url.pathname === "/services/PABC123") return reply({ service: { id: "PABC123", name: "Shop" } })
      return url.pathname === "/users" && url.searchParams.get("query") === "estate@example.com"
        ? reply({ users })
        : undefined
    }
    const estate = { email: "Estate@example.com", name: "Estate" }
    return Promise.all([
      run(pagerDuty(settings).check, account([{ email: "estate@example.com.au", name: "Other" }, estate])),
      run(pagerDuty(settings).check, account([])),
    ]).then(([found, missing]) => {
      expect(found).toEqual(Result.succeed("raises in Shop (PABC123) as Estate (Estate@example.com)"))
      expect(Result.isFailure(missing) && missing.failure.message).toBe(
        "PagerDuty has no user estate@example.com to raise as",
      )
    })
  })
})
