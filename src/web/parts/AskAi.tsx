/** @jsxImportSource solid-js */
/**
 * Ask AI about an alert: the model reads the alert's brief and answers with a likely cause, its evidence and what to
 * do next. Leaving the page stops the ask; the answer can be kept as a note for everyone.
 */
import { createSignal, For, onCleanup, Show } from "solid-js"
import type { AskAnswer } from "../../shared/ask"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { Out } from "./A"

/** The answer as a note: the model's name, then each part on its own line. */
const noteOf = (answer: AskAnswer): string =>
  [
    `Ask AI (${answer.model}): ${answer.likelyCause}`,
    ...answer.evidence.map((each) => `· ${each.text}`),
    ...answer.nextSteps.map((step) => `Next: ${step}`),
    `Confidence: ${answer.confidence}`,
  ].join("\n")

export const AskAi = (props: { readonly alert: Alert }) => {
  const { me, actions } = useEstate()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [answer, setAnswer] = createSignal<AskAnswer | undefined>(undefined)
  const [kept, setKept] = createSignal(false)
  let asking: AbortController | undefined
  onCleanup(() => asking?.abort())
  const ask = () => {
    if (busy()) return
    asking = new AbortController()
    const signal = asking.signal
    setBusy(true)
    setError(undefined)
    setAnswer(undefined)
    setKept(false)
    void actions.askAlert(props.alert.id, signal).then((result) => {
      if (signal.aborted) return
      setBusy(false)
      if (typeof result === "string") setError(result)
      else setAnswer(result)
    })
  }
  const keep = () => {
    const found = answer()
    if (found === undefined) return
    void actions.addNote(props.alert.id, noteOf(found)).then((saved) => setKept(saved))
  }
  return (
    <section aria-labelledby="ask-ai" class="stack" aria-busy={busy()}>
      <h2 id="ask-ai" class="section-title">
        Ask AI
      </h2>
      <Show
        when={me.ai === true}
        fallback={
          <p class="muted" style={{ margin: 0 }}>
            Ask AI is not configured. Set <span class="mono">ai:</span> in estate.yaml to enable it.
          </p>
        }
      >
        <p class="muted" style={{ margin: 0 }}>
          The model reads what is around this alert, as the page shows it, and answers from that alone.
        </p>
        <div class="choices">
          <button type="button" class="primary-button" disabled={busy()} onClick={ask}>
            {busy() ? "Reading Estate…" : "Ask AI"}
          </button>
          <Show when={answer() !== undefined && !kept()}>
            <button type="button" class="amber-button ghost" onClick={keep}>
              Keep as note
            </button>
          </Show>
          <Show when={kept()}>
            <span class="muted">Kept as a note.</span>
          </Show>
        </div>
        <Show when={error()}>
          {(message) => (
            <p class="alert-detail" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <div aria-live="polite">
          <Show when={answer()}>
            {(found) => (
              <article class="ask-answer panel section-box">
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
                  {found().model} · read: {found().read.join(" · ")}
                  {found().called.length === 0 ? "" : ` · called: ${found().called.join(" · ")}`}
                </p>
              </article>
            )}
          </Show>
        </div>
      </Show>
    </section>
  )
}
