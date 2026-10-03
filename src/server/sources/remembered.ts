/** A tool's last answer about a service's builds, kept with its ETag so an unchanged one costs a 304. */
import type { Build } from "../../shared/events"

export interface Remembered {
  readonly etag: string
  readonly builds: ReadonlyArray<Build>
}

/** How many of a service's builds are shown. */
export const shown = 8
