/** The demo world's time: when it started, which every part of its story is told from, and its environments. */
export const environments = ["production", "staging"] as const
export type Environment = (typeof environments)[number]

/** When the world started, in milliseconds since the epoch: the story is told from here, the same each time. */
export const started = Date.now()

/** Now, in seconds since the epoch, as Prometheus writes a sample's time. */
export const at = () => Date.now() / 1000

export const minutesAgo = (minutes: number, from = started) => new Date(from - minutes * 60_000).toISOString()

/** A number that drifts around `base` by `swing`, the same at the same moment, so a chart looks alive. */
export const wave = (base: number, swing: number, phase: number) => (seconds: number) =>
  base + swing * Math.sin(seconds / 600 + phase) + (swing / 4) * Math.sin(seconds / 47 + phase * 3)

/** A small whole number from a name, so each service has its own size and phase. */
export const seedOf = (name: string) => [...name].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) % 9973, 7)
