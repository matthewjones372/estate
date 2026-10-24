/**
 * Processes the demo runs together, their output shown as the demo's own. Ctrl-C or SIGTERM stops them all and exits
 * 0. Anything else that ends one of them, or the demo itself, stops the rest and exits non-zero, so a supervisor such
 * as systemd sees a failure and nothing is left holding the demo's ports.
 */
export const together = (commands: ReadonlyArray<{ cmd: string[] } & Bun.SpawnOptions.OptionsObject>) => {
  const started = commands.map((command) => Bun.spawn({ stdout: "inherit", stderr: "inherit", ...command }))
  let stopping = false
  const stop = (code: number) => {
    stopping = true
    for (const child of started) child.kill()
    process.exit(code)
  }
  const fail = (why: string, code = 1) => {
    process.stderr.write(`${why}\n`)
    stop(code)
  }
  process.on("SIGINT", () => stop(0))
  process.on("SIGTERM", () => stop(0))
  // Bun runs no exit handlers on an uncaught error, so this is the only place to stop what was started.
  process.on("uncaughtException", (error) => fail(`demo: ${error.stack ?? error}`))
  process.on("unhandledRejection", (error) => fail(`demo: ${error instanceof Error ? error.stack : error}`))

  for (const child of started)
    child.exited.then((code) => {
      if (!stopping) fail(`demo: a process exited with ${code}`, code === 0 ? 1 : code)
    })

  return { fail }
}
