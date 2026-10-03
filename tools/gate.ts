/**
 * `bun run gate` runs every check and exits 1 if any fails. As the Stop hook (`--hook`) it exits 2 instead, which
 * keeps an agent's turn going with the report as its next instruction.
 */
import { passed, report, runGate } from "./gate/checks"

const asHook = process.argv.includes("--hook")

const outcomes = await runGate(async (check) => {
  const child = Bun.spawn(["bun", "run", check], { stdout: "pipe", stderr: "pipe", env: { ...process.env, CI: "1" } })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { passed: code === 0, output: `${stdout}${stderr}` }
})

const text = `${report(outcomes)}\n`
if (passed(outcomes)) {
  process.stdout.write(text)
} else if (asHook) {
  process.stderr.write(text)
  process.exit(2)
} else {
  process.stdout.write(text)
  process.exit(1)
}
