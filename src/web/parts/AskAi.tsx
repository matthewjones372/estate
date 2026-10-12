/** @jsxImportSource solid-js */
/**
 * Ask AI about an alert, on its card: the model reads the alert's brief and answers with a likely cause, its evidence
 * and what to do next, on the card that asked. An ask is kept per firing while Estate is open, so the same alert's
 * card on another page shows it too; leaving the card that asked stops an ask still out.
 */
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { AskAnswer } from "../../shared/ask"
import { money } from "../../shared/costs"
import type { Alert } from "../../shared/events"
import { longestNote } from "../../shared/note"
import { type Actions, useEstate } from "../context"
import { Out } from "./A"

/**
 * The answer as a note: the model's name, then each part on its own line. A note has a longest, and an answer can
 * pass it, so evidence goes from the end first, saying how much, and what is left is cut short.
 */
export const noteOf = (answer: AskAnswer): string => {
  const written = (evidence: number) =>
    [
      `Ask AI (${answer.model}): ${answer.likelyCause}`,
      ...answer.evidence.slice(0, evidence).map((each) => `· ${each.text}`),
      ...(evidence < answer.evidence.length ? [`· and ${answer.evidence.length - evidence} more on the card`] : []),
      ...answer.nextSteps.map((step) => `Next: ${step}`),
      `Confidence: ${answer.confidence}`,
    ].join("\n")
  const fits = Array.from({ length: answer.evidence.length + 1 }, (_, dropped) => answer.evidence.length - dropped)
    .map(written)
    .find((note) => note.length <= longestNote)
  const whole = written(0)
  return fits ?? `${whole.slice(0, longestNote - 1)}…`
}

/** "15,000 in (11,800 cached) · 1,100 out · about $0.03": what the answer took, and cost where it is priced. */
const spent = (answer: AskAnswer): string => {
  const { input, cached, output } = answer.usage
  const count = (tokens: number) => tokens.toLocaleString("en-GB")
  const tokens = `${count(input + cached)} in${cached === 0 ? "" : ` (${count(cached)} cached)`} · ${count(output)} out`
  if (answer.cost === undefined) return tokens
  const { amount, currency } = answer.cost
  return `${tokens} · ${amount < 0.01 ? `under ${money(0.01, currency)}` : `about ${money(amount, currency)}`}`
}

const held = <T,>(initial: T) => {
  const [get, set] = createSignal<T>(initial)
  return { get, set }
}

/** One firing's ask: when it went out, while it is out, whether it may be asked again yet, and what came back. */
const anAsk = () => ({
  since: held<number | undefined>(undefined),
  resting: held(false),
  error: held<string | undefined>(undefined),
  answer: held<AskAnswer | undefined>(undefined),
  kept: held<"no" | "keeping" | "kept" | "failed">("no"),
})

type Ask = ReturnType<typeof anAsk>

// Keyed by the page's actions, which live as long as Estate is open in the tab, and each test's are its own.
/** As the server's ask limits: one answer an alert a minute, so the button rests rather than earn a refusal. */
const rest = 60_000

const asks = new WeakMap<Actions, Map<string, Ask>>()

const askAbout = (actions: Actions, alert: Alert): Ask => {
  const mine = asks.get(actions) ?? new Map<string, Ask>()
  asks.set(actions, mine)
  const firing = `${alert.id} ${alert.startsAt}`
  const found = mine.get(firing) ?? anAsk()
  mine.set(firing, found)
  return found
}

/** *Ask AI* among the card's buttons, when `ai:` is set. */
export const AskAiButton = (props: { readonly alert: Alert }) => {
  const { me, actions, now } = useEstate()
  const ask = () => askAbout(actions, props.alert)
  let out: { readonly controller: AbortController; readonly ask: Ask } | undefined
  onCleanup(() => {
    if (out === undefined || out.ask.since.get() === undefined) return
    out.controller.abort()
    out.ask.since.set(undefined)
    out.ask.resting.set(false)
  })
  const start = () => {
    const state = ask()
    if (state.since.get() !== undefined || state.resting.get()) return
    const controller = new AbortController()
    out = { controller, ask: state }
    state.since.set(now())
    state.resting.set(true)
    setTimeout(() => state.resting.set(false), rest)
    state.error.set(undefined)
    // An answer already there stays until a new one replaces it, so a refusal never takes it away.
    void actions.askAlert(props.alert.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      state.since.set(undefined)
      if (typeof result === "string") state.error.set(result)
      else {
        state.answer.set(result)
        state.kept.set("no")
      }
    })
  }
  const busy = () => ask().since.get() !== undefined
  return (
    <Show when={me.ai === true}>
      <button
        type="button"
        class="amber-button ghost ask-button"
        disabled={busy() || ask().resting.get()}
        aria-busy={busy()}
        title={!busy() && ask().resting.get() ? "One answer an alert a minute" : undefined}
        onClick={start}
      >
        <Show when={busy()} fallback={ask().answer.get() === undefined ? "Ask AI" : "Ask again"}>
          <span class="ask-spinner" aria-hidden="true" />
          Asking…
        </Show>
        <span class="visually-hidden"> about {props.alert.name}</span>
      </button>
    </Show>
  )
}

/** A bar that moves, and the seconds since the ask went out, so a long wait reads as work. */
const Reading = (props: { readonly since: number; readonly alert: string }) => {
  const { now } = useEstate()
  const [at, setAt] = createSignal(now())
  const ticking = setInterval(() => setAt(now()), 1_000)
  onCleanup(() => clearInterval(ticking))
  return (
    <div class="ask-reading">
      <div class="ask-bar" role="progressbar" aria-label={`Asking AI about ${props.alert}`} />
      <span class="muted">Reading Estate… {Math.max(0, Math.round((at() - props.since) / 1_000))} s</span>
    </div>
  )
}

/** What the card's ask has come to: the bar while it is out, then the answer, or why there is none. */
export const AskAiAnswer = (props: { readonly alert: Alert }) => {
  const { me, actions } = useEstate()
  const ask = () => askAbout(actions, props.alert)
  const keep = () => {
    const state = ask()
    const found = state.answer.get()
    if (found === undefined || state.kept.get() === "keeping" || state.kept.get() === "kept") return
    state.kept.set("keeping")
    void actions
      .addNote(props.alert.id, noteOf(found), "ask-ai")
      .then((saved) => state.kept.set(saved ? "kept" : "failed"))
  }
  return (
    <Show when={me.ai === true}>
      <div class="ask-ai" aria-live="polite" aria-busy={ask().since.get() !== undefined}>
        <Show when={ask().since.get()}>{(since) => <Reading since={since()} alert={props.alert.name} />}</Show>
        <Show when={ask().error.get()}>
          {(message) => (
            <p class="alert-detail" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <Show when={ask().answer.get()}>
          {(found) => (
            <article class="ask-answer section-box">
              <p>
                <span class="alert-label">Likely cause</span> {found().likelyCause}
              </p>
              <p>
                <span class="alert-label">Confidence</span> {found().confidence}
              </p>
              <div>
                <span class="alert-label">Evidence</span>
                <ul>
                  <For each={found().evidence}>
                    {(each) => (
                      <li>
                        <Show when={each.href} fallback={each.text}>
                          {(href) => <Out href={href()}>{each.text}</Out>}
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
              <div>
                <span class="alert-label">Next steps</span>
                <ul>
                  <For each={found().nextSteps}>{(step) => <li>{step}</li>}</For>
                </ul>
              </div>
              <p class="alert-quiet">
                {found().model} · {spent(found())} · read: {found().read.join(" · ")}
                {found().called.length === 0 ? "" : ` · called: ${found().called.join(" · ")}`}
              </p>
              <div class="choices ask-keep">
                <Show
                  when={ask().kept.get() === "kept"}
                  fallback={
                    <button
                      type="button"
                      class="amber-button ghost ask-button"
                      disabled={ask().kept.get() === "keeping"}
                      aria-busy={ask().kept.get() === "keeping"}
                      onClick={keep}
                    >
                      <Show when={ask().kept.get() === "keeping"} fallback="Keep as note">
                        <span class="ask-spinner" aria-hidden="true" />
                        Keeping…
                      </Show>
                    </button>
                  }
                >
                  <span class="ask-kept" role="status">
                    ✓ Kept as a note, under Notes above
                  </span>
                </Show>
                <Show when={ask().kept.get() === "failed"}>
                  <span class="alert-detail" role="alert">
                    The note could not be kept. Try again.
                  </span>
                </Show>
              </div>
            </article>
          )}
        </Show>
      </div>
    </Show>
  )
}
