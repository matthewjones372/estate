/**
 * A measure taken again when Playwright loses its browser mid-way. On CI, now and then, Chromium goes away with
 * nothing in its log while the page is drawn or idle; the browser's going is no measure of Estate, so a fresh one
 * measures again, up to three tries, and the run says it happened.
 */
const tries = 3

const isClosed = (error: unknown) => error instanceof Error && error.message.includes("has been closed")

export const againIfClosed = async <A>(measure: () => Promise<A>, say: (line: string) => void): Promise<A> => {
  for (let tried = 1; ; tried++) {
    try {
      return await measure()
    } catch (error) {
      if (tried >= tries || !isClosed(error)) throw error
      say(`The browser went away (${(error as Error).message.split("\n")[0]}), so the page is measured again.`)
    }
  }
}
