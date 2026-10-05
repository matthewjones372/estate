/** @jsxImportSource solid-js */
/** Ask AI about an alert: streams a structured answer when `ai` is configured; otherwise says so. */
import { createSignal, For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import type { AskAnswer } from "../ask"
import { useEstate, useSnapshot } from "../context"

export type { AskAnswer } from "../ask"

export const AskAi = (props: { readonly alert: Alert }) => {
  const { me, actions } = useEstate()
  const snapshot = useSnapshot()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  const [stream, setStream] = createSignal("")
  const [answer, setAnswer] = createSignal<AskAnswer | undefined>(undefined)
  const configured = () => me.ai === true
  const ask = async () => {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    setStream("")
    setAnswer(undefined)
    const result = await actions.askAlert(props.alert.id, (chunk) => setStream((was) => was + chunk))
    setBusy(false)
    if (result === undefined) {
      setError("Ask AI could not answer. Try again, or check that the model is reachable.")
      return
    }
    if (typeof result === "string") {
      setError(result)
      return
    }
    setAnswer(result)
  }
  const keep = () => {
    const found = answer()
    if (found === undefined) return
    const text = [
      `Ask AI (${found.model}): ${found.likelyCause}`,
      ...found.evidence.map((each) => `· ${each.text}`),
      ...found.nextSteps.map((step) => `Next: ${step}`),
      `Confidence: ${found.confidence}`,
    ].join("\n")
    void actions.addNote(props.alert.id, text)
  }
  return (
    <section aria-labelledby="ask-ai" class="stack">
      <h2 id="ask-ai" class="section-title">
        Ask AI
      </h2>
      <Show
        when={configured()}
        fallback={
          <p class="muted" style={{ margin: 0 }}>
            Ask AI is not configured. Set <span class="mono">ai:</span> in estate.yaml to enable it.
          </p>
        }
      >
        <p class="muted" style={{ margin: 0 }}>
          Estate gathers what changed near this alert, then asks the model. It will not invent evidence.
        </p>
        <div class="choices">
          <button type="button" class="primary-button" disabled={busy()} onClick={() => void ask()}>
            {busy() ? "Reading Estate…" : "Ask AI"}
          </button>
          <Show when={answer()}>
            <button type="button" class="amber-button ghost" onClick={keep}>
              Keep as note
            </button>
          </Show>
        </div>
        <Show when={error()}>{(message) => <p class="alert-detail">{message()}</p>}</Show>
        <Show when={busy() && stream() !== ""}>
          <pre class="ask-stream mono">{stream()}</pre>
        </Show>
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
                  <For each={found().evidence}>{(each) => <li>{each.text}</li>}</For>
                </ul>
              </div>
              <div>
                <span class="alert-label">Next steps</span>
                <ul>
                  <For each={found().nextSteps}>{(step) => <li>{step}</li>}</For>
                </ul>
              </div>
              <p class="alert-quiet">
                {found().model}
                {found().tools.length === 0 ? "" : ` · looked at: ${found().tools.join(" · ")}`}
                {" · "}
                {snapshot.environment}
              </p>
            </article>
          )}
        </Show>
      </Show>
    </section>
  )
}
