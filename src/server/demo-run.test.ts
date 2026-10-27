import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** How `examples/demo/run.ts` holds the world and Estate, tried with stand-ins for them. */
const together = new URL("../../examples/demo/together.ts", import.meta.url).pathname

/** A stand-in that writes down its pid and runs until it is stopped. */
const lasting = (pidFile: string) => [
  "bun",
  "-e",
  `await Bun.write(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
]
const endingWith = (code: number) => ["bun", "-e", `await Bun.sleep(500); process.exit(${code})`]

const spare = () => join(tmpdir(), `demo-run-${crypto.randomUUID()}`)

/** A zombie has stopped; it lingers until whatever adopted it reaps it, which some containers' init is slow to do. */
const isRunning = (pid: number) => {
  const state = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)])
    .stdout.toString()
    .trim()
  return state !== "" && !state.startsWith("Z")
}

const pidIn = (file: string, tries = 100): Promise<number> =>
  Bun.file(file)
    .text()
    .then((text) => (text === "" ? Promise.reject(new Error("not written yet")) : Number(text)))
    .catch(() =>
      tries > 0
        ? Bun.sleep(50).then(() => pidIn(file, tries - 1))
        : Promise.reject(new Error("the lasting stand-in never started")),
    )

/** A runner holding the lasting stand-in and `other` together, then running `then`. */
const runner = (other: ReadonlyArray<string>, then = "") => {
  const pidFile = join(tmpdir(), `demo-run-${crypto.randomUUID()}`)
  const started = Bun.spawn(
    [
      "bun",
      "-e",
      `import { together } from ${JSON.stringify(together)}
const demo = together([{ cmd: ${JSON.stringify(lasting(pidFile))} }, { cmd: ${JSON.stringify(other)} }])
${then}`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  return { started, lasting: () => pidIn(pidFile) }
}

/** How the runner ended: its code, what it wrote to stderr, and whether the lasting stand-in outlived it. */
const ended = (run: ReturnType<typeof runner>) =>
  Promise.all([run.lasting(), run.started.exited, new Response(run.started.stderr).text()]).then(([pid, code, said]) =>
    Bun.sleep(200).then(() => ({ code, said, lastingRuns: isRunning(pid) })),
  )

describe("the demo's runner", () => {
  test("fails with a process's code, and stops the other, when that process fails", () =>
    ended(runner(endingWith(3))).then(({ code, said, lastingRuns }) => {
      expect(said).toContain("demo: a process exited with 3")
      expect(code).toBe(3)
      expect(lastingRuns).toBe(false)
    }))

  test("fails, and stops the other, when a process ends on its own even cleanly", () =>
    ended(runner(endingWith(0))).then(({ code, said, lastingRuns }) => {
      expect(said).toContain("demo: a process exited with 0")
      expect(code).toBe(1)
      expect(lastingRuns).toBe(false)
    }))

  test("fails, and stops what it started, when it gives up", () =>
    ended(runner(lasting(spare()), `await Bun.sleep(500); demo.fail("Estate did not become ready")`)).then(
      ({ code, said, lastingRuns }) => {
        expect(said).toContain("Estate did not become ready")
        expect(code).toBe(1)
        expect(lastingRuns).toBe(false)
      },
    ))

  test("fails, and stops what it started, when it breaks itself", () =>
    ended(runner(lasting(spare()), `await Bun.sleep(500); JSON.parse("held")`)).then(({ code, lastingRuns }) => {
      expect(code).toBe(1)
      expect(lastingRuns).toBe(false)
    }))

  test("stops cleanly, and stops what it started, on SIGTERM", () => {
    const run = runner(lasting(spare()))
    return run
      .lasting()
      .then(() => run.started.kill("SIGTERM"))
      .then(() => ended(run))
      .then(({ code, lastingRuns }) => {
        expect(code).toBe(0)
        expect(lastingRuns).toBe(false)
      })
  })
})
