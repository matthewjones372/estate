/** DynamoDB's JSON API, each call signed with the credentials AWS's tools would find. */
import { Clock, Data, Effect, FileSystem, Schema } from "effect"
import { Remote } from "../remote"
import { makeCredentials } from "./credentials"
import { sign } from "./sign"

export const DynamoError = Data.TaggedError("DynamoError")<{ readonly type: string; readonly message: string }>
export type DynamoError = InstanceType<typeof DynamoError>

const Refusal = Schema.Struct({
  __type: Schema.String,
  message: Schema.optionalKey(Schema.String),
  Message: Schema.optionalKey(Schema.String),
})
const decodeRefusal = Schema.decodeUnknownOption(Schema.fromJsonString(Refusal))
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

export type Dynamo = (operation: string, body: unknown) => Effect.Effect<unknown, DynamoError>

/** A caller of DynamoDB in `region`, or at `endpoint` (DynamoDB Local, say). */
export const makeDynamo = (region: string, endpoint?: string) =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const fs = yield* FileSystem.FileSystem
    const credentials = (yield* makeCredentials).pipe(
      Effect.provideService(Remote, remote),
      Effect.provideService(FileSystem.FileSystem, fs),
    )
    const url = endpoint ?? `https://dynamodb.${region}.amazonaws.com/`
    const failed = (message: string) => new DynamoError({ type: "Unreachable", message })
    const dynamo: Dynamo = (operation, body) =>
      Effect.gen(function* () {
        const signed = sign(
          {
            method: "POST",
            url,
            headers: {
              "content-type": "application/x-amz-json-1.0",
              "x-amz-target": `DynamoDB_20120810.${operation}`,
            },
            body: JSON.stringify(body),
          },
          yield* credentials.pipe(Effect.mapError((error) => failed(error.message))),
          { region, service: "dynamodb" },
          yield* Clock.currentTimeMillis,
        )
        const answered = yield* remote
          .call({ url, method: "POST", headers: signed.headers, body: signed.body ?? "" })
          .pipe(Effect.mapError((error) => failed(`DynamoDB ${error.message}`)))
        if (answered.status === 200)
          return yield* decodeAnswer(answered.text === "" ? "{}" : answered.text).pipe(
            Effect.mapError(() => new DynamoError({ type: "Unknown", message: "DynamoDB answered with no JSON" })),
          )
        const refusal = decodeRefusal(answered.text)
        if (refusal._tag === "None")
          return yield* new DynamoError({ type: "Unknown", message: `DynamoDB answered ${answered.status}` })
        const { __type: type, message, Message } = refusal.value
        return yield* new DynamoError({
          type: type.slice(type.lastIndexOf("#") + 1),
          message: message ?? Message ?? type,
        })
      })
    return dynamo
  })
