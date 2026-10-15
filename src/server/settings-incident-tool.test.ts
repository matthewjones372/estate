import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Redacted, Result } from "effect"
import { readSettings } from "./settings"
import { readBackEvery } from "./settings-incident-tool"

const base = `
catalog: /etc/estate/catalog.yaml
auth: { sessionSecret: "${"s".repeat(32)}", roles: { viewer: [], operator: [] }, anonymous: { name: visitor, role: viewer } }
sources: {}
`

const read = (text: string) =>
  Effect.result(readSettings(`${base}${text}`)).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ PAGERDUTY_TOKEN: "pd-key", INCIDENTIO_TOKEN: "io-key" }),
    ),
  )

const pagerduty = (every: string) =>
  `incidentTool:\n  pagerduty: { token: \${PAGERDUTY_TOKEN}, from: estate@example.com, service: PABC123${every} }\n`

describe("the incident tool in the settings", () => {
  test("is PagerDuty with its token from the environment, kept secret", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read(pagerduty(", every: 30s"))
        const tool = Result.isSuccess(result) ? result.success.incidentTool?.pagerduty : undefined
        expect(tool === undefined ? undefined : Redacted.value(tool.token)).toBe("pd-key")
        expect(String(tool?.token)).toBe("<redacted>")
        expect([tool?.from, tool?.service, tool?.every]).toEqual(["estate@example.com", "PABC123", "30s"])
        expect(Result.isSuccess(result) && readBackEvery(result.success.incidentTool)).toBe(30)
        expect(readBackEvery(undefined)).toBe(60)
      }),
    ))

  test("is read no more often than every five seconds, and says so for an interval that is not one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const [often, soon] = [yield* read(pagerduty(", every: 1s")), yield* read(pagerduty(", every: soon"))]
        expect(Result.isFailure(often) && often.failure.mistakes).toEqual([
          { at: "incidentTool.pagerduty.every", message: '"1s" is under 5s, the most often Estate reads' },
        ])
        expect(Result.isFailure(soon) && soon.failure.mistakes).toEqual([
          { at: "incidentTool.pagerduty.every", message: '"soon" is not a duration: write 30s, 2m or 1h' },
        ])
      }),
    ))

  test("needs the user PagerDuty raises as", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("incidentTool: { pagerduty: { token: x, service: PABC123 } }\n")
        expect(Result.isFailure(result) && result.failure.mistakes.map((each) => each.at)).toEqual([
          "incidentTool.pagerduty.from",
        ])
      }),
    ))

  test("is incident.io with its key from the environment, the severity it raises at, and its mode", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read(
          "incidentTool: { incidentio: { token: ${INCIDENTIO_TOKEN}, severity: Minor, mode: test, every: 2m } }\n",
        )
        const tool = Result.isSuccess(result) ? result.success.incidentTool?.incidentio : undefined
        expect(tool === undefined ? undefined : Redacted.value(tool.token)).toBe("io-key")
        expect([tool?.severity, tool?.mode]).toEqual(["Minor", "test"])
        expect(Result.isSuccess(result) && readBackEvery(result.success.incidentTool)).toBe(120)
      }),
    ))

  test("is one tool an Estate, each read no more often than every five seconds", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read(
          `${pagerduty("")}  incidentio: { token: x, severity: Minor, mode: loud, every: 1s }\n`,
        )
        expect(Result.isFailure(result) && result.failure.mistakes.map((each) => each.at)).toEqual([
          "incidentTool.incidentio.mode",
        ])
        const both = yield* read(`${pagerduty("")}  incidentio: { token: x, severity: Minor, every: 1s }\n`)
        expect(Result.isFailure(both) && both.failure.mistakes).toEqual([
          { at: "incidentTool", message: "names one tool an Estate raises in: pagerduty or incidentio" },
          { at: "incidentTool.incidentio.every", message: '"1s" is under 5s, the most often Estate reads' },
        ])
      }),
    ))
})
