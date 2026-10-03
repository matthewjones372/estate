/** The gate: every check, in order, each run whatever the one before it said, so one pass names everything. */

export const checks = ["typecheck", "lint", "unused", "layers", "slop", "test"] as const

type Check = (typeof checks)[number]

export interface Outcome {
  readonly check: Check
  readonly passed: boolean
  readonly output: string
}

export type Run = (check: Check) => Promise<{ readonly passed: boolean; readonly output: string }>

export const runGate = async (run: Run): Promise<ReadonlyArray<Outcome>> => {
  const outcomes: Outcome[] = []
  for (const check of checks) outcomes.push({ check, ...(await run(check)) })
  return outcomes
}

const tailLines = 60

const tail = (output: string): string => {
  const lines = output.trimEnd().split("\n")
  return lines.length <= tailLines ? lines.join("\n") : ["…", ...lines.slice(-tailLines)].join("\n")
}

export const report = (outcomes: ReadonlyArray<Outcome>): string => {
  const failed = outcomes.filter((outcome) => !outcome.passed)
  const summary = outcomes.map((outcome) => `${outcome.passed ? "pass" : "FAIL"}  ${outcome.check}`).join("\n")
  const details = failed.map((outcome) => `── ${outcome.check} ──\n${tail(outcome.output)}`).join("\n\n")
  const verdict =
    failed.length === 0
      ? "gate: passed"
      : `gate: failed (${failed.map((outcome) => outcome.check).join(", ")}). Nothing is done until it passes.`
  return [details, summary, verdict].filter((part) => part !== "").join("\n\n")
}

export const passed = (outcomes: ReadonlyArray<Outcome>): boolean => outcomes.every((outcome) => outcome.passed)
