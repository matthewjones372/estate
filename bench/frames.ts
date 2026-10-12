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

// DEBUG: each patch's leaves by path, services folded, so a frame says what it carried.
const shapeOf = (patch: unknown, path: string, into: Map<string, { count: number; bytes: number }>) => {
  const p = patch as Record<string, unknown>
  const leaf = (kind: string) => {
    const key = `${path.replace(/svc-\d+/g, "svc-*")} ${kind}`
    const was = into.get(key) ?? { count: 0, bytes: 0 }
    into.set(key, { count: was.count + 1, bytes: was.bytes + JSON.stringify(patch).length })
  }
  if ("set" in p) leaf(Array.isArray(p.set) ? `set[${p.set.length}]` : `set:${typeof p.set}`)
  else if ("shift" in p) leaf(`shift${String(p.shift)}+${(p.tail as Array<unknown>).length}`)
  else {
    for (const [key, each] of Object.entries(p.keys as Record<string, unknown>)) shapeOf(each, `${path}.${key}`, into)
    if (p.drop !== undefined) leaf(`drop${JSON.stringify(p.drop)}`)
  }
}
const t0 = Date.now()
const debug = (frame: Frame, bytes: number) => {
  if (frame._tag === "Whole") process.stderr.write(`DEBUG whole +${((Date.now() - t0) / 1000).toFixed(1)}s ${bytes}B\n`)
  if (frame._tag !== "Changed" || bytes < 2000) return
  const shape = new Map<string, { count: number; bytes: number }>()
  for (const [env, parts] of Object.entries(frame.environments))
    for (const [part, patch] of Object.entries(parts)) shapeOf(patch, `${env}.${part}`, shape)
  for (const [part, patch] of Object.entries(frame.parts)) shapeOf(patch, part, shape)
  const lines = [...shape].map(([key, { count, bytes }]) => `    ${key} x${count} ${bytes}B`).join("\n")
  process.stderr.write(
    `DEBUG frame +${((Date.now() - t0) / 1000).toFixed(1)}s ${new Date().toISOString()} ${bytes}B\n${lines}\n`,
  )
}

/** Waits until the tools have been asked for every range at least once and then nothing for two seconds. */
const firstReadsDone = async (calls: () => number, size: number) => {
  let last = -1
  while (calls() !== last || calls() < size * 6) {
    last = calls()
    await Bun.sleep(2000)
  }
}

let fetched = 0
const realFetch = globalThis.fetch
const debugFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetched += 1
  const started = performance.now()
  const url = String(input instanceof Request ? input.url : input)
  const report = (outcome: string) => {
    const took = performance.now() - started
    if (took < 1000) return
    const arrivals = (
      (globalThis as Record<string, unknown>)["DEBUG_ARRIVALS"] as Map<string, Array<string>> | undefined
    )?.get(url)
    process.stderr.write(
      `DEBUG slow fetch ${Math.round(took)}ms from +${Math.round(started)}ms ${outcome} ${url.slice(0, 160)} server saw ${JSON.stringify(arrivals ?? [])}\n`,
    )
  }
  try {
    const response = await realFetch(input, init)
    report(`status ${response.status}`)
    return response
  } catch (error) {
    report(`error ${String(error)}`)
    throw error
  }
}) as typeof fetch
globalThis.fetch = debugFetch

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
            debug(frame, bytes)
            if (frame._tag === "Changed") counted.largest = Math.max(counted.largest, bytes)
            counted.total += bytes
            counted.frames += 1
          }),
        ),
      )
      yield* Effect.promise(() => firstReadsDone(tools.calls, size))
      process.stderr.write(
        `DEBUG measuring from +${((Date.now() - t0) / 1000).toFixed(1)}s ${new Date().toISOString()} calls ${tools.calls()} fetched ${fetched}\n`,
      )
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
