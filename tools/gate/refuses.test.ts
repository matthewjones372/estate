import { describe, expect, test } from "bun:test"
import { commands, fixture } from "./fixture"

const slow = 60_000

/** Runs one check on the clean project with `files` added, and returns what it said. */
const check = (command: keyof typeof commands, files: Record<string, string> = {}) => {
  const project = fixture(files)
  try {
    return project.run(commands[command])
  } finally {
    project.remove()
  }
}

const refuses = (command: keyof typeof commands, files: Record<string, string>, says: RegExp) => {
  const ran = check(command, files)
  expect(ran.output).toMatch(says)
  expect(ran.passed).toBe(false)
}

describe("the gate", () => {
  test(
    "passes the clean project on every check",
    () => {
      for (const command of Object.keys(commands) as Array<keyof typeof commands>) {
        const ran = check(command)
        expect({ command, ...ran }).toMatchObject({ command, passed: true })
      }
    },
    slow,
  )

  test("refuses code short of strict", () => {
    refuses("typecheck", { "src/shared/a.ts": "export const a = (b) => b\n" }, /TS7006/)
  })

  test("refuses an index read as if it could not miss", () => {
    refuses("typecheck", { "src/shared/a.ts": "export const a = (b: string[]): string => b[0]\n" }, /TS2322/)
  })

  test("refuses undefined where an optional property was left out", () => {
    const text = "type A = { b?: string }\nexport const a: A = { b: undefined }\n"
    refuses("typecheck", { "src/shared/a.ts": text }, /TS2375/)
  })

  test("refuses format drift", () => {
    refuses("lint", { "src/shared/a.ts": "export const a  =  1;\n" }, /format/)
  })

  test("refuses console", () => {
    refuses("lint", { "src/shared/a.ts": 'export const a = () => console.log("a")\n' }, /noConsole/)
  })

  test("refuses a non-null assertion", () => {
    refuses("lint", { "src/shared/a.ts": "export const a = (b: string | null) => b!.length\n" }, /noNonNullAssertion/)
  })

  test("refuses an unused import", () => {
    refuses(
      "lint",
      { "src/shared/a.ts": 'import { join } from "node:path"\n\nexport const a = 1\n' },
      /noUnusedImports/,
    )
  })

  test("refuses an unused variable", () => {
    refuses(
      "lint",
      { "src/shared/a.ts": "export const a = () => {\n  const b = 1\n  return 2\n}\n" },
      /noUnusedVariables/,
    )
  })

  test("refuses any", () => {
    refuses("lint", { "src/shared/a.ts": "export const a = (b: any) => b\n" }, /noExplicitAny/)
  })

  test("refuses a file nothing uses", () => {
    refuses("unused", { "src/shared/a.ts": "export const a = 1\n" }, /Unused files/)
  })

  test("refuses an export nothing uses", () => {
    const text = "export const greeting = (who: string): string => `hello ${who}`\nexport const b = 1\n"
    refuses("unused", { "src/shared/greeting.ts": text }, /Unused exports/)
  })

  test("refuses a dependency nothing uses", () => {
    const pkg = {
      name: "fixture",
      type: "module",
      dependencies: { effect: "*" },
      devDependencies: { "@types/bun": "*" },
    }
    refuses("unused", { "package.json": JSON.stringify(pkg) }, /Unused dependencies/)
  })

  test("refuses shared importing anything of ours", () => {
    const files = {
      "src/shared/a.ts": 'import { b } from "../server/b"\n\nexport const a = b\n',
      "src/server/b.ts": "export const b = 1\n",
    }
    refuses("layers", files, /shared-imports-nothing-of-ours/)
  })

  test("refuses server importing web", () => {
    const files = {
      "src/server/a.ts": 'import { b } from "../web/b"\n\nexport const a = b\n',
      "src/web/b.ts": "export const b = 1\n",
    }
    refuses("layers", files, /server-never-imports-web/)
  })

  test("refuses web importing server", () => {
    const files = {
      "src/web/a.ts": 'import { b } from "../server/b"\n\nexport const a = b\n',
      "src/server/b.ts": "export const b = 1\n",
    }
    refuses("layers", files, /web-never-imports-server/)
  })

  test("refuses slop in any file, tracked or not", () => {
    refuses("slop", { "src/server/a.ts": 'export const a = () => {\n  throw new Error("a")\n}\n' }, /a\.ts:2 throw/)
  })

  test(
    "refuses a failing test",
    () => {
      refuses(
        "test",
        { "src/shared/a.test.ts": 'import { expect, test } from "bun:test"\n\ntest("a", () => expect(1).toBe(2))\n' },
        /1 fail/,
      )
    },
    slow,
  )

  test(
    "refuses coverage under 90% of lines, with every test passing",
    () => {
      const untested = Array.from(
        { length: 20 },
        (_, index) => `export const f${index} = (n: number): number => {\n  return n + ${index}\n}\n`,
      )
      refuses(
        "test",
        {
          "src/shared/untested.ts": untested.join(""),
          "src/shared/untested.test.ts":
            'import { expect, test } from "bun:test"\nimport { f0 } from "./untested"\n\ntest("f0 adds nothing", () => expect(f0(1)).toBe(1))\n',
        },
        / 0 fail\n/,
      )
    },
    slow,
  )
})
