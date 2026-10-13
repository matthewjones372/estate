/** Durations in the settings, written as `30s`, `2m` or `1h`. */

const units: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3600 }

/** The seconds in `30s`, `2m` or `1h`, or nothing if it is not written so. */
export const secondsIn = (text: string): number | undefined => {
  const match = /^(\d+)(s|m|h)$/.exec(text)
  return match === null ? undefined : Number(match[1]) * (units[match[2] ?? ""] ?? 0)
}

/** What the settings say of a duration that is not written as one. */
export const notADuration = (text: string | undefined) => `"${text}" is not a duration: write 30s, 2m or 1h`
