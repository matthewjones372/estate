/**
 * AWS's JSON APIs (DynamoDB, ECS, CloudWatch): an operation and its body POSTed to the service's endpoint, named in
 * `x-amz-target`, each call signed with the credentials AWS's tools would find.
 */
import { Clock, Data, Effect, FileSystem, Schema } from "effect"
import { Remote } from "../remote"
import { makeCredentials } from "./credentials"
import { sign } from "./sign"

export const AwsCallError = Data.TaggedError("AwsCallError")<{ readonly type: string; readonly message: string }>
export type AwsCallError = InstanceType<typeof AwsCallError>

const Refusal = Schema.Struct({
  __type: Schema.String,
  message: Schema.optionalKey(Schema.String),
  Message: Schema.optionalKey(Schema.String),
})
const decodeRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(Refusal))
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

export type AwsJson = (operation: string, body: unknown) => Effect.Effect<unknown, AwsCallError>

export interface Api {
  /** The service's name in signatures and its host: `dynamodb`, `ecs`, `monitoring`. */
  readonly service: string
  /** What goes before the operation in `x-amz-target`: `DynamoDB_20120810`. */
  readonly target: string
  /** The JSON protocol's version: 1.0 for DynamoDB and CloudWatch, 1.1 for ECS. */
  readonly version: "1.0" | "1.1"
  /** What AWS calls the service in its error messages. */
  readonly name: string
}

/** A caller of one of AWS's JSON APIs in `region`, or at `endpoint` (DynamoDB Local, say). */
export const makeAwsJson = (api: Api, region: string, endpoint?: string) =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const fs = yield* FileSystem.FileSystem
    const credentials = (yield* makeCredentials).pipe(
      Effect.provideService(Remote, remote),
      Effect.provideService(FileSystem.FileSystem, fs),
    )
    const url = endpoint ?? `https://${api.service}.${region}.amazonaws.com/`
    const failed = (message: string) => new AwsCallError({ type: "Unreachable", message })
    const call: AwsJson = (operation, body) =>
      Effect.gen(function* () {
        const signed = sign(
          {
            method: "POST",
            url,
            headers: {
              "content-type": `application/x-amz-json-${api.version}`,
              "x-amz-target": `${api.target}.${operation}`,
            },
            body: JSON.stringify(body),
          },
          yield* credentials.pipe(Effect.mapError((error) => failed(error.message))),
          { region, service: api.service },
          yield* Clock.currentTimeMillis,
        )
        const answered = yield* remote
          .call({ url, method: "POST", headers: signed.headers, body: signed.body ?? "" })
          .pipe(Effect.mapError((error) => failed(`${api.name} ${error.message}`)))
        if (answered.status === 200)
          return yield* decodeAnswer(answered.text === "" ? "{}" : answered.text).pipe(
            Effect.mapError(() => new AwsCallError({ type: "Unknown", message: `${api.name} answered with no JSON` })),
          )
        const refusal = decodeRefusal(answered.text)
        if (refusal._tag === "None")
          return yield* new AwsCallError({ type: "Unknown", message: `${api.name} answered ${answered.status}` })
        const { __type: type, message, Message } = refusal.value
        return yield* new AwsCallError({
          type: type.slice(type.lastIndexOf("#") + 1),
          message: message ?? Message ?? type,
        })
      })
    return call
  })
