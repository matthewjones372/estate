/**
 * What a clustered Estate sends each follower: `bun bench/frames.ts [services]`. Runs Estate's readers in this
 * process against the bench's tools, turns its state into `Follow` frames as the owner does, and measures them as
 * the runners' NDJSON carries them: the whole estate a follower starts with, the largest change, and the bytes a
 * minute once the first reads are done, from a point in a step of the series so that it holds one step of each.
 */
import { Clock, Effect, Fiber, Schema, Stream, SubscriptionRef } from "effect"
import { background, prepare, services } from "../src/server/app"
import { framesOf } from "../src/server/cluster/owner"
import { Frame, toWire } from "../src/server/cluster/wire"
import { platform } from "../src/server/platform"
import { liveRemote } from "../src/server/remote"
import { lastHour } from "../src/server/sources/prometheus"
import { Estate, type EstateState } from "../src/server/state"
import { stubWeb } from "../src/server/web"
import { writeEstate } from "./estate"
import { startTools } from "./tools"

const [count = 50] = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map(Number)
const minute = 60_000
const encode = Schema.encodeSync(Frame)
const bytesOf = (frame: Frame) => new TextEncoder().encode(JSON.stringify(encode(frame))).byteLength

const parts = ["metrics", "alerts", "cluster", "deploys", "costs"] as const

/**
 * Done once Estate has no part still waiting for its first read. The tools' calls cannot say so: a read with one
 * slow answer leaves them quiet while it waits, and its first read, the whole part, then lands in the minute.
 */
const firstReadsDone = (estate: Estate) =>
  SubscriptionRef.changes(estate).pipe(
    Stream.filter((state) =>
      Object.values(state.environments).every((environment) =>
        parts.every((part) => environment[part].state !== "waiting"),
      ),
    ),
    Stream.take(1),
    Stream.runDrain,
  )

/** Done once each environment's metrics have been read again since `then`, whether they answered or failed. */
const metricsReadAgain = (estate: Estate, then: EstateState) =>
  SubscriptionRef.changes(estate).pipe(
    Stream.filter((state) =>
      Object.entries(state.environments).every(([name, environment]) => {
        const was = then.environments[name]?.metrics
        const is = environment.metrics
        return is.state === "off" || was === undefined || is.answeredAt !== was.answeredAt || is.state !== was.state
      }),
    ),
    Stream.take(1),
    Stream.runDrain,
  )

/**
 * Until 40 s into the next step of the series. A read asks for the hour up to the step it started in, every 30 s,
 * so by then the read that took this step has landed, and a minute from there holds exactly one step of each.
 */
const intoNextStep = Effect.gen(function* () {
  const step = lastHour.step * 1000
  const now = yield* Clock.currentTimeMillis
  yield* Effect.sleep((40_000 - (now % step) + step) % step)
})

export const measureFrames = async (size: number) => {
  const tools = startTools(size, 20)
  try {
    const dir = await writeEstate(size, tools.url)
    const started = await Effect.runPromise(prepare(`${dir}/estate.yaml`).pipe(Effect.provide(platform)))
    const counted = { largest: 0, total: 0, frames: 0 }
    const program = Effect.gen(function* () {
      const reading = yield* Effect.forkChild(background(started))
      const estate = yield* Estate
      const sending = yield* Effect.forkChild(
        Stream.runForEach(framesOf(estate, "bench"), (frame) =>
          Effect.sync(() => {
            const bytes = bytesOf(frame)
            if (frame._tag === "Changed") counted.largest = Math.max(counted.largest, bytes)
            counted.total += bytes
            counted.frames += 1
          }),
        ),
      )
      yield* firstReadsDone(estate)
      // A slow first read is old when it lands, so the reads after it are not 30 s apart until the next one.
      yield* metricsReadAgain(estate, yield* SubscriptionRef.get(estate))
      // Time for the frames of those reads to be counted before the minute starts.
      yield* Effect.sleep("2 seconds")
      yield* intoNextStep
      const before = { ...counted }
      // The largest change once read, not the first reads, when every part goes from waiting to read whole.
      counted.largest = 0
      yield* Effect.sleep(minute)
      yield* Fiber.interrupt(sending)
      yield* Fiber.interrupt(reading)
      // The whole a follower starts with, once every part has been read.
      const whole = bytesOf({ _tag: "Whole", owner: "bench", estate: toWire(yield* SubscriptionRef.get(estate)) })
      return { before, after: { ...counted }, whole }
    })
    const web = stubWeb("<!doctype html>", {})
    const { before, after, whole } = await Effect.runPromise(
      program.pipe(Effect.provide(services(started, web, liveRemote))),
    )
    return {
      wholeKB: Math.round(whole / 102.4) / 10,
      largestChangeKB: Math.round(after.largest / 102.4) / 10,
      perMinuteKB: Math.round((after.total - before.total) / 102.4) / 10,
      framesPerMinute: after.frames - before.frames,
    }
  } finally {
    tools.stop()
  }
}

if (import.meta.main) {
  const measured = await measureFrames(count)
  process.stdout.write(`${JSON.stringify({ services: count, ...measured })}\n`)
}
