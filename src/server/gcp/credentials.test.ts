import { describe, expect, test } from "bun:test"
import { ConfigProvider, type Duration, Effect, FileSystem, Layer, Redacted, Result } from "effect"
import { TestClock } from "effect/testing"
import * as jose from "jose"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { makeGcpCredentials } from "./credentials"

const sampleToken = { access_token: "ya29.sample-token", expires_in: 3600 }

const fakeGcp =
  (calls: Call[]) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.url.includes("oauth2.googleapis.com/token")) return reply(sampleToken)
    if (call.url.includes("metadata.google.internal") && call.headers?.["Metadata-Flavor"] === "Google")
      return reply(sampleToken)
    return undefined
  }

const found = (
  environment: Record<string, string>,
  answer: (call: Call) => Reply | undefined = fakeGcp([]),
  times = 1,
  between: Duration.Input = "0 seconds",
) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const credentials = yield* makeGcpCredentials
        const first = yield* credentials
        for (let count = 1; count < times; count++) {
          yield* TestClock.adjust(between)
          yield* credentials
        }
        return first
      }).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(environment)),
        Effect.provide(Layer.mergeAll(stubRemote(answer), TestClock.layer(), platform)),
      ),
    ),
  )

describe("GCP credentials", () => {
  test("are the environment's direct token first", () =>
    found({ GCP_ACCESS_TOKEN: "ya29.direct-token" }).then((result) => {
      const creds = Result.isSuccess(result) ? result.success : undefined
      expect(Redacted.value(creds?.accessToken ?? Redacted.make(""))).toBe("ya29.direct-token")
      expect(creds?.expiresAt).toBeUndefined()
    }))

  test("are obtained by exchanging a service account key JWT", () =>
    jose
      .generateKeyPair("RS256", { extractable: true })
      .then((pair) => jose.exportPKCS8(pair.privateKey))
      .then((pkcs8) => {
        const saKey = JSON.stringify({
          type: "service_account",
          client_email: "estate@test.iam.gserviceaccount.com",
          private_key: pkcs8,
          token_uri: "https://oauth2.googleapis.com/token",
        })

        return Effect.runPromise(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem
            const path = yield* fs.makeTempFile()
            yield* fs.writeFileString(path, saKey)
            return path
          }).pipe(Effect.provide(platform)),
        ).then((file) => {
          const calls: Call[] = []
          return found({ GOOGLE_APPLICATION_CREDENTIALS: file }, fakeGcp(calls)).then((result) => {
            expect(Result.isSuccess(result)).toBe(true)
            if (Result.isSuccess(result)) {
              expect(Redacted.value(result.success.accessToken)).toBe("ya29.sample-token")
              expect(result.success.expiresAt).toBeDefined()
            }
            expect(calls.length).toBe(1)
            expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token")
          })
        })
      }))

  test("are obtained by refreshing an authorized user token", () => {
    const userKey = JSON.stringify({
      type: "authorized_user",
      client_id: "test-client.apps.googleusercontent.com",
      client_secret: "topsecret",
      refresh_token: "refresh-12345",
    })

    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* fs.makeTempFile()
        yield* fs.writeFileString(path, userKey)
        return path
      }).pipe(Effect.provide(platform)),
    ).then((file) => {
      const calls: Call[] = []
      return found({ GOOGLE_APPLICATION_CREDENTIALS: file }, fakeGcp(calls)).then((result) => {
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(Redacted.value(result.success.accessToken)).toBe("ya29.sample-token")
        }
        expect(calls.length).toBe(1)
      })
    })
  })

  test("are read from the metadata server when on GCP", () => {
    const calls: Call[] = []
    return found({}, fakeGcp(calls)).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(Redacted.value(result.success.accessToken)).toBe("ya29.sample-token")
      }
      expect(calls[0]?.url).toContain("metadata.google.internal")
    })
  })

  test("say when no credentials can be found", () =>
    found({}, () => undefined).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain("no GCP credentials")
      }
    }))

  test("are cached until five minutes before expiration", () => {
    const kept: Call[] = []
    const renewed: Call[] = []
    const calls = (arr: Call[]) => arr.filter((c) => c.url.includes("metadata.google.internal")).length

    return Promise.all([found({}, fakeGcp(kept), 3, "10 minutes"), found({}, fakeGcp(renewed), 2, "56 minutes")]).then(
      () => {
        expect(calls(kept)).toBe(1)
        expect(calls(renewed)).toBe(2)
      },
    )
  })

  test("fail when key file cannot be read or is invalid", () =>
    found({ GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/gcp-key.json" }, () => undefined).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.message).toContain("nonexistent")
      }
      return Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* fs.makeTempFile()
          yield* fs.writeFileString(path, "{ invalid json")
          return path
        }).pipe(Effect.provide(platform)),
      ).then((badFile) =>
        found({ GOOGLE_APPLICATION_CREDENTIALS: badFile }, () => undefined).then((badResult) => {
          expect(Result.isFailure(badResult)).toBe(true)
        }),
      )
    }))

  test("fail when token endpoint or metadata answers with invalid JSON", () => {
    const badReply = () => reply("not json", 200)
    return found({}, badReply).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
    })
  })

  test("fail when token exchange endpoint refuses with non-200 or network error", () => {
    const userKey = JSON.stringify({
      type: "authorized_user",
      client_id: "id",
      client_secret: "secret",
      refresh_token: "refresh",
    })
    const badSaKey = JSON.stringify({
      type: "service_account",
      client_email: "test@example.com",
      private_key: "not-pkcs8",
      token_uri: "https://oauth2.googleapis.com/token",
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const userPath = yield* fs.makeTempFile()
        yield* fs.writeFileString(userPath, userKey)
        const saPath = yield* fs.makeTempFile()
        yield* fs.writeFileString(saPath, badSaKey)
        return [userPath, saPath] as const
      }).pipe(Effect.provide(platform)),
    ).then(([userFile, saFile]) =>
      found({ GOOGLE_APPLICATION_CREDENTIALS: userFile }, () => reply({ error: "bad" }, 400)).then((resUser) => {
        expect(Result.isFailure(resUser)).toBe(true)
        return found({ GOOGLE_APPLICATION_CREDENTIALS: userFile }, () => undefined).then((resUserNet) => {
          expect(Result.isFailure(resUserNet)).toBe(true)
          return found({ GOOGLE_APPLICATION_CREDENTIALS: saFile }, () => undefined).then((resSa) => {
            expect(Result.isFailure(resSa)).toBe(true)
          })
        })
      }),
    )
  })
})
