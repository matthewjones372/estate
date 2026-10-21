/**
 * Waiting in the bench, with a deadline: a wait that runs out fails saying what it waited for and what it last saw,
 * so a run that would have hung until the gate's step timeout says which part stalled.
 */
export const until = async (
  what: string,
  done: () => Promise<boolean>,
  options: { readonly within: number; readonly every: number; readonly saw?: () => string },
) => {
  const deadline = performance.now() + options.within
  while (!(await done())) {
    if (performance.now() > deadline) {
      const saw = options.saw?.() ?? ""
      throw new Error(
        `${what} did not happen within ${options.within / 1000} s${saw === "" ? "" : `; last seen: ${saw}`}`,
      )
    }
    await Bun.sleep(options.every)
  }
}

/** A line on stderr as each phase starts, so a run's log says how far it got. */
export const phase = (started: number) => (name: string) =>
  process.stderr.write(`bench: ${name} (${Math.round((performance.now() - started) / 1000)} s)\n`)

/** A step that may never answer, such as a call into a wedged Chromium, given a deadline that names it. */
export const deadline = <A>(what: string, within: number, step: Promise<A>): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${within / 1000} s`)), within)
  })
  return Promise.race([step, late]).finally(() => clearTimeout(timer))
}
