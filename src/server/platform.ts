/** The machine Estate runs on, as Effect services: its files and its paths, from Bun. */
import { BunFileSystem, BunPath } from "@effect/platform-bun"
import { Effect, FileSystem, Layer } from "effect"

export const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer)

/** A file's text, or the failure to read it. */
export const readText = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path)
  })
