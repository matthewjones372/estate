import { describe, expect, test } from "bun:test"
import { ConfigProvider, type Duration, Effect, FileSystem, Layer, Redacted, Result } from "effect"
import { TestClock } from "effect/testing"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { makeCredentials } from "./credentials"

const role = {
  AccessKeyId: "ASIAROLE",
  SecretAccessKey: "role-secret",
  Token: "role-token",
  Expiration: "1970-01-01T01:00:00Z",
}

/** The container's and the instance's endpoints, as AWS answers them. */
const aws =
  (calls: Call[]) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.url === "http://169.254.170.2/v2/credentials/abc") return reply(role)
    if (call.url === "http://pod-identity/v1/credentials")
      return call.headers?.["authorization"] === "eks-token" ? reply(role) : reply("no", 403)
    if (call.url === "http://169.254.169.254/latest/api/token" && call.method === "PUT") return reply("imds-token")
    if (call.headers?.["x-aws-ec2-metadata-token"] !== "imds-token") return undefined
    if (call.url === "http://169.254.169.254/latest/meta-data/iam/security-credentials/") return reply("estate-role\n")
    if (call.url === "http://169.254.169.254/latest/meta-data/iam/security-credentials/estate-role") return reply(role)
    return undefined
  }

const found = (
  environment: Record<string, string>,
  answer: (call: Call) => Reply | undefined = aws([]),
  times = 1,
  between: Duration.Input = "0 seconds",
) =>
  Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const credentials = yield* makeCredentials
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

describe("AWS credentials", () => {
  test("are the environment's keys first", () =>
    found({ AWS_ACCESS_KEY_ID: "AKIDEXAMPLE", AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "token" }).then(
      (result) => {
        const credentials = Result.isSuccess(result) ? result.success : undefined
        expect(credentials?.accessKeyId).toBe("AKIDEXAMPLE")
        expect(Redacted.value(credentials?.secretAccessKey ?? Redacted.make(""))).toBe("secret")
        expect(credentials?.sessionToken === undefined ? undefined : Redacted.value(credentials.sessionToken)).toBe(
          "token",
        )
        expect(credentials?.expiresAt).toBeUndefined()
      },
    ))

  test("are the container's role, an ECS task's or a pod's, with the token it is given", () => {
    const calls: Call[] = []
    return found({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc" }, aws(calls)).then((result) => {
      expect(Result.isSuccess(result) && result.success).toMatchObject({
        accessKeyId: "ASIAROLE",
        expiresAt: 3_600_000,
      })
      return found(
        {
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://pod-identity/v1/credentials",
          AWS_CONTAINER_AUTHORIZATION_TOKEN: "eks-token",
        },
        aws(calls),
      ).then((pod) => {
        expect(Result.isSuccess(pod) && pod.success.accessKeyId).toBe("ASIAROLE")
      })
    })
  })

  test("read the container's token from its file, as EKS Pod Identity mounts it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const file = yield* fs.makeTempFile()
        yield* fs.writeFileString(file, "eks-token\n")
        return file
      }).pipe(Effect.provide(platform)),
    ).then((file) =>
      Promise.all([
        found({
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://pod-identity/v1/credentials",
          AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: file,
        }),
        found({
          AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://pod-identity/v1/credentials",
          AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: "/nowhere/token",
        }),
        found({ AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://pod-identity/v1/credentials" }),
      ]).then(([read, unreadable, refused]) => {
        expect(Result.isSuccess(read)).toBe(true)
        expect(Result.isFailure(unreadable) && unreadable.failure.message).toBe("/nowhere/token cannot be read")
        expect(Result.isFailure(refused) && refused.failure.message).toBe("the container's role gave no credentials")
      }),
    ))

  test("are the instance's role through IMDSv2", () => {
    const calls: Call[] = []
    return found({}, aws(calls)).then((result) => {
      expect(Result.isSuccess(result) && result.success.accessKeyId).toBe("ASIAROLE")
      expect(calls[0]).toMatchObject({ method: "PUT", headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" } })
    })
  })

  test("say how to give some when there are none, or the instance has no role", () => {
    const noRole = (call: Call) => (call.url.endsWith("/api/token") ? reply("imds-token") : undefined)
    return Promise.all([found({}, () => undefined), found({}, noRole)]).then(([none, roleless]) => {
      expect(Result.isFailure(none) && none.failure.message).toStartWith("no AWS credentials")
      expect(Result.isFailure(roleless) && roleless.failure.message).toBe("the instance has no role")
    })
  })

  test("are kept until five minutes before they expire, then fetched again", () => {
    const kept: Call[] = []
    const renewed: Call[] = []
    const fetches = (calls: Call[]) => calls.filter((call) => call.url.includes("/v2/credentials/abc")).length
    const environment = { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc" }
    return Promise.all([
      found(environment, aws(kept), 3, "10 minutes"),
      found(environment, aws(renewed), 2, "56 minutes"),
    ]).then(() => {
      expect(fetches(kept)).toBe(1)
      expect(fetches(renewed)).toBe(2)
    })
  })
})
