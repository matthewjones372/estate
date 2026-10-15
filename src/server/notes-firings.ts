/** A firing, and a time, as a Postgres row holds them: read back into what Estate keeps. */
import type { StoredFiring } from "./state"
import { iso } from "./time"

export const instant = (value: unknown) => iso(value instanceof Date ? value : String(value))

export const firingOf = (row: Record<string, unknown>): StoredFiring => ({
  environment: String(row["environment"]),
  alert: String(row["alert"]),
  name: String(row["name"]),
  ...(row["service"] === null || row["service"] === undefined ? {} : { service: String(row["service"]) }),
  startsAt: instant(row["starts_at"]),
  ...(row["ends_at"] === null || row["ends_at"] === undefined ? {} : { endsAt: instant(row["ends_at"]) }),
  ...(row["silenced_by"] === null || row["silenced_by"] === undefined
    ? {}
    : { silence: { by: String(row["silenced_by"]), reason: String(row["silence_reason"] ?? "") } }),
  ...Object.fromEntries(
    (["severity", "summary", "runbook", "store"] as const).flatMap((key) =>
      row[key] === null || row[key] === undefined ? [] : [[key, String(row[key])]],
    ),
  ),
})
