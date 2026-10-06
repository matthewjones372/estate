/** How often each part of an environment is read: its usual interval, unless its sources set another. */
import { Duration } from "effect"
import { type Settings, type Sources, secondsIn } from "../settings"

const usual = { alerts: "20s", metrics: "30s", cluster: "15s", deploys: "30s", costs: "6h" } as const
type Part = keyof typeof usual

const durationOf = (text: string | undefined, otherwise: string) =>
  Duration.seconds(secondsIn(text ?? "") ?? secondsIn(otherwise) ?? 0)

export const everyOf = (section: Sources, part: Part): Duration.Duration =>
  durationOf(section.every?.[part], usual[part])

export const buildsEvery = (builds: NonNullable<Settings["builds"]>): Duration.Duration =>
  durationOf(builds.every, "60s")

/** Each part's interval, as `estate doctor` prints it; costs only where the section reads them. */
export const intervalsOf = (section: Sources): string =>
  (Object.keys(usual) as ReadonlyArray<Part>)
    .filter((part) => part !== "costs" || section.costs !== undefined)
    .map((part) => `${part} ${section.every?.[part] ?? usual[part]}`)
    .join(", ")
