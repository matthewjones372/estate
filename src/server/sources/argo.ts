/**
 * What Argo CD chose for each service: the version its Application deployed, whether it is in sync and healthy, and
 * when it is not, why, in the words Argo used.
 */
import { Effect, Redacted, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import { callJson, type Remote } from "../remote"
import type { Sources } from "../settings"
import type { Chosen } from "../state"
import { type Failure, SourceFailure } from "./run"

type Argo = NonNullable<Sources["argo"]>

const Application = Schema.Struct({
  status: Schema.optionalKey(
    Schema.Struct({
      sync: Schema.optionalKey(Schema.Struct({ status: Schema.String, revision: Schema.optionalKey(Schema.String) })),
      health: Schema.optionalKey(Schema.Struct({ status: Schema.String, message: Schema.optionalKey(Schema.String) })),
      operationState: Schema.optionalKey(
        Schema.Struct({
          phase: Schema.String,
          message: Schema.optionalKey(Schema.String),
          finishedAt: Schema.optionalKey(Schema.String),
        }),
      ),
      conditions: Schema.optionalKey(Schema.Array(Schema.Struct({ type: Schema.String, message: Schema.String }))),
      summary: Schema.optionalKey(Schema.Struct({ images: Schema.optionalKey(Schema.Array(Schema.String)) })),
      reconciledAt: Schema.optionalKey(Schema.String),
    }),
  ),
})
type Status = NonNullable<(typeof Application.Type)["status"]>

/** The tag of the image named for the service, or of the only one. */
const versionOf = (service: Service, status: Status): string => {
  const images = status.summary?.images ?? []
  const image =
    images.find((each) => each.includes(`/${service.name}:`)) ?? (images.length === 1 ? images[0] : undefined)
  const colon = image?.lastIndexOf(":") ?? -1
  if (image !== undefined && colon > image.lastIndexOf("/")) return image.slice(colon + 1)
  return status.sync?.revision?.slice(0, 7) ?? "unknown"
}

/** Why the Application is stuck, in Argo's words; nothing while a sync is still running. */
const stalledBy = (status: Status): string | undefined => {
  const operation = status.operationState
  if (operation?.phase === "Running") return undefined
  if (operation?.phase === "Failed" || operation?.phase === "Error") return operation.message ?? "the sync failed"
  const error = status.conditions?.find((condition) => condition.type.endsWith("Error"))
  if (error !== undefined) return error.message
  if (status.health?.status === "Degraded") return status.health.message ?? "Argo CD says it is degraded"
  return status.sync?.status === "OutOfSync" ? "out of sync, and no sync is running" : undefined
}

export const chosenOf = (service: Service, status: Status): Chosen =>
  compact({
    version: versionOf(service, status),
    ready: status.sync?.status === "Synced" && status.health?.status === "Healthy",
    at: status.operationState?.finishedAt ?? status.reconciledAt,
    stalled: stalledBy(status),
  })

/** Every service's Application, read side by side. */
export const readArgo = (
  argo: Argo,
  services: ReadonlyArray<Service>,
): Effect.Effect<Readonly<Record<string, Chosen>>, Failure, Remote> =>
  Effect.forEach(
    services.flatMap((service) => {
      const application = service.deploy?.argo?.application
      return application === undefined ? [] : [[service, application] as const]
    }),
    ([service, application]) =>
      callJson({
        url: `${argo.url.replace(/\/$/, "")}/api/v1/applications/${encodeURIComponent(application)}`,
        headers: argo.token === undefined ? {} : { authorization: `Bearer ${Redacted.value(argo.token)}` },
      }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Application)),
        Effect.mapError(
          (error) =>
            new SourceFailure({
              message:
                error._tag === "RemoteError"
                  ? `Argo CD ${error.message}`
                  : `Argo CD answered for ${application} in a shape Estate does not know`,
            }),
        ),
        Effect.map((found) => [service.name, chosenOf(service, found.status ?? {})] as const),
      ),
    { concurrency: 4 },
  ).pipe(Effect.map(Object.fromEntries))
