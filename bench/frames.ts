/**
 * What a clustered Estate sends each follower: `bun bench/frames.ts [services]`. Runs Estate's readers in this
 * process against the bench's tools, turns its state into `Follow` frames as the owner does, and measures them as
 * the runners' NDJSON carries them: the whole estate a follower starts with, the largest change, and the bytes a
 * minute once the first reads are done.
 */
import { Effect, Fiber, Schema, Stream, SubscriptionRef } from "effect"
import { background, prepare, services } from "../src/server/app"
import { framesOf } from "../src/server/cluster/owner"
import { Frame, toWire } from "../src/server/cluster/wire"
import { platform } from "../src/server/platform"
import { liveRemote } from "../src/server/remote"
import { Estate } from "../src/server/state"
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

/** Waits until the tools have been asked for every range at least once and then nothing for two seconds. */
const firstReadsDone = async (calls: () => number, size: number) => {
  let last = -1
  while (calls() !== last || calls() < size * 6) {
    last = calls()
    await Bun.sleep(2000)
  }
}

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
      yield* Effect.promise(() => firstReadsDone(tools.calls, size))
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
