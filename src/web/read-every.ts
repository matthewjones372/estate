/** A read a page panel makes when it opens, and again while it is open and seen (specs 0057 and 0060). */
import { type Accessor, createEffect, createSignal, on, onCleanup } from "solid-js"

/**
 * What `read` answers for the key, read again every `often` milliseconds while the tab is seen and on coming back to
 * one left longer than that. A read again keeps what is drawn until it answers, and a failure in between leaves it.
 */
export const readEvery = <A>(
  key: Accessor<string>,
  read: (key: string) => Promise<A | string>,
  often: Accessor<number>,
): Accessor<A | string | "loading"> => {
  const [answer, setAnswer] = createSignal<A | string | "loading">("loading")
  createEffect(
    on(key, (now) => {
      let current = true
      let readAt = 0
      const every = often()
      setAnswer("loading")
      const again = (repeat: boolean) => {
        readAt = Date.now()
        void read(now).then((answered) => {
          if (current && (!repeat || typeof answered !== "string")) setAnswer(() => answered)
        })
      }
      const visible = () => document.visibilityState !== "hidden"
      again(false)
      const timer = setInterval(() => visible() && again(true), every)
      const back = () => visible() && Date.now() - readAt >= every && again(true)
      document.addEventListener("visibilitychange", back)
      onCleanup(() => {
        current = false
        clearInterval(timer)
        document.removeEventListener("visibilitychange", back)
      })
    }),
  )
  return answer
}
