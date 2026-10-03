/** A small clean project in a temporary directory, held to this repository's own gate configuration. */
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const repo = join(import.meta.dir, "..", "..")
const configs = ["tsconfig.json", "biome.json", ".dependency-cruiser.cjs", "bunfig.toml", ".gitignore"]

const clean: Record<string, string> = {
  "package.json":
    '{\n  "name": "fixture",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "bun test"\n  },\n  "devDependencies": {\n    "@types/bun": "*"\n  }\n}\n',
  "knip.json": '{\n  "entry": ["src/server/main.ts"],\n  "project": ["src/**/*.ts"]\n}\n',
  "src/shared/greeting.ts": "export const greeting = (who: string): string => `hello ${who}`\n",
  "src/shared/greeting.test.ts": [
    'import { expect, test } from "bun:test"',
    'import { greeting } from "./greeting"',
    "",
    'test("a greeting names who it greets", () => {',
    '  expect(greeting("estate")).toBe("hello estate")',
    "})",
    "",
  ].join("\n"),
  "src/server/main.ts": 'import { greeting } from "../shared/greeting"\n\nprocess.stdout.write(greeting("estate"))\n',
}

interface Ran {
  readonly passed: boolean
  readonly output: string
}

export interface Fixture {
  readonly run: (command: ReadonlyArray<string>) => Ran
  readonly remove: () => void
}

const bin = (name: string): string => join(repo, "node_modules", ".bin", name)

export const commands = {
  typecheck: [bin("tsc"), "--noEmit"],
  lint: [bin("biome"), "check", "."],
  unused: [bin("knip"), "--no-progress"],
  layers: [bin("depcruise"), ".", "--config", ".dependency-cruiser.cjs"],
  slop: ["bun", join(repo, "tools", "slop.ts")],
  test: ["bun", "test", "--coverage"],
} as const

/** The clean project, with `files` added or replacing its own. */
export const fixture = (files: Record<string, string> = {}): Fixture => {
  const root = mkdtempSync(join(tmpdir(), "estate-gate-"))
  for (const config of configs) cpSync(join(repo, config), join(root, config))
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"))
  for (const [path, text] of Object.entries({ ...clean, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: root })
  return {
    run: (command) => {
      const ran = Bun.spawnSync([...command], { cwd: root, env: { ...process.env, CI: "1", NO_COLOR: "1" } })
      return { passed: ran.exitCode === 0, output: `${ran.stdout.toString()}${ran.stderr.toString()}` }
    },
    remove: () => rmSync(root, { recursive: true, force: true }),
  }
}
