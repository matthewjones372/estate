/**
 * Where AWS credentials come from, in the order AWS's own tools look: the environment's keys, then the role of the
 * container (ECS task roles, EKS Pod Identity), then the role of the instance (IMDSv2). Fetched credentials are kept
 * until five minutes before they expire.
 */
import { Clock, Config, Data, Effect, FileSystem, Option, Redacted, Ref, Schema } from "effect"
import { callJson, Remote } from "../remote"
import type { Credentials } from "./sign"

const AwsError = Data.TaggedError("AwsError")<{ readonly message: string }>

const Fetched = Schema.Struct({
  AccessKeyId: Schema.String,
  SecretAccessKey: Schema.String,
  Token: Schema.optionalKey(Schema.String),
  Expiration: Schema.optionalKey(Schema.String),
})
const decodeFetched = Schema.decodeUnknownEffect(Fetched)

const credentialsOf = (fetched: typeof Fetched.Type): Credentials => ({
  accessKeyId: fetched.AccessKeyId,
  secretAccessKey: Redacted.make(fetched.SecretAccessKey),
  ...(fetched.Token === undefined ? {} : { sessionToken: Redacted.make(fetched.Token) }),
  ...(fetched.Expiration === undefined ? {} : { expiresAt: Date.parse(fetched.Expiration) }),
})

const variable = (name: string) =>
  Config.option(Config.String(name)).pipe(Effect.orElseSucceed(() => Option.none<string>()))

const fromEnvironment = Effect.gen(function* () {
  const id = yield* variable("AWS_ACCESS_KEY_ID")
  const secret = yield* variable("AWS_SECRET_ACCESS_KEY")
  const token = yield* variable("AWS_SESSION_TOKEN")
  if (Option.isNone(id) || Option.isNone(secret)) return Option.none<Credentials>()
  return Option.some<Credentials>({
    accessKeyId: id.value,
    secretAccessKey: Redacted.make(secret.value),
    ...(Option.isSome(token) ? { sessionToken: Redacted.make(token.value) } : {}),
  })
})

const fetched = (url: string, headers: Readonly<Record<string, string>>, from: string) =>
  callJson({ url, headers }).pipe(
    Effect.flatMap(decodeFetched),
    Effect.map(credentialsOf),
    Effect.mapError(() => new AwsError({ message: `the ${from} gave no credentials` })),
  )

const fromContainer = Effect.gen(function* () {
  const relative = yield* variable("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
  const full = yield* variable("AWS_CONTAINER_CREDENTIALS_FULL_URI")
  const url = Option.isSome(relative) ? `http://169.254.170.2${relative.value}` : Option.getOrUndefined(full)
  if (url === undefined) return Option.none<Credentials>()
  const token = yield* variable("AWS_CONTAINER_AUTHORIZATION_TOKEN")
  const tokenFile = yield* variable("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE")
  const fs = yield* FileSystem.FileSystem
  const fromFile: string | undefined = Option.isSome(tokenFile)
    ? yield* fs
        .readFileString(tokenFile.value)
        .pipe(Effect.mapError(() => new AwsError({ message: `${tokenFile.value} cannot be read` })))
    : undefined
  const authorization = fromFile ?? Option.getOrUndefined(token)
  const headers: Readonly<Record<string, string>> =
    authorization === undefined ? {} : { authorization: authorization.trim() }
  return Option.some(yield* fetched(url, headers, "container's role"))
})

const metadata = "http://169.254.169.254/latest"

/** A text answer from the instance's metadata, or nothing off EC2, where it does not answer within a second. */
const askInstance = (path: string, headers: Readonly<Record<string, string>>, method: "GET" | "PUT" = "GET") =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const answered = yield* remote
      .call({ url: `${metadata}${path}`, method, headers })
      .pipe(Effect.timeout("1 second"), Effect.option)
    return Option.isSome(answered) && answered.value.status === 200 ? answered.value.text.trim() : undefined
  })

const fromInstance = Effect.gen(function* () {
  const token = yield* askInstance("/api/token", { "x-aws-ec2-metadata-token-ttl-seconds": "21600" }, "PUT")
  if (token === undefined) return Option.none<Credentials>()
  const headers = { "x-aws-ec2-metadata-token": token }
  const role = (yield* askInstance("/meta-data/iam/security-credentials/", headers))?.split("\n")[0]
  if (role === undefined || role === "") return yield* new AwsError({ message: "the instance has no role" })
  return Option.some(
    yield* fetched(`${metadata}/meta-data/iam/security-credentials/${role}`, headers, "instance's role"),
  )
})

const sources = [fromEnvironment, fromContainer, fromInstance]

const firstFound = Effect.gen(function* () {
  for (const source of sources) {
    const found = yield* source
    if (Option.isSome(found)) return found.value
  }
  return yield* new AwsError({
    message: "no AWS credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or run with a task or instance role",
  })
})

const early = 5 * 60_000

/** Credentials as AWS's tools find them, kept until five minutes before they expire. */
export const makeCredentials = Effect.gen(function* () {
  const kept = yield* Ref.make(Option.none<Credentials>())
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const held = yield* Ref.get(kept)
    if (Option.isSome(held) && (held.value.expiresAt ?? Number.POSITIVE_INFINITY) - early > now) return held.value
    const found = yield* firstFound
    yield* Ref.set(kept, Option.some(found))
    return found
  })
})
