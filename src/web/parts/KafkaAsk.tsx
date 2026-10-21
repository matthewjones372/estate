/** @jsxImportSource solid-js */
/**
 * Ask AI about a Kafka store's cluster (spec 0057), where Ask AI is set: the model reads the cluster as Estate read it
 * and answers with a likely cause, its evidence and what to do next, with what the answer took.
 */
import { createSignal, For, Show } from "solid-js"
import type { AskAnswer } from "../../shared/ask"
import { useEstate } from "../context"
import { spent } from "./AskAi"

export const ClusterAsk = (props: { readonly store: string }) => {
  const { actions, me } = useEstate()
  const [asking, setAsking] = createSignal(false)
  const [answer, setAnswer] = createSignal<AskAnswer | string | undefined>(undefined)
  const ask = () => {
    setAsking(true)
    void actions.askStore(props.store).then((read) => {
      setAnswer(read)
      setAsking(false)
    })
  }
  const found = () => {
    const read = answer()
    return typeof read === "string" ? undefined : read
  }
  return (
    <Show when={me.ai === true}>
      <div class="kafka-ask" aria-live="polite" aria-busy={asking()}>
        <button type="button" class="amber-button ghost ask-button" disabled={asking()} onClick={ask}>
          {asking() ? "Asking…" : "Ask AI"}
        </button>
        <Show when={typeof answer() === "string"}>
          <p class="alert-detail" role="alert">
            {answer() as string}
          </p>
        </Show>
        <Show when={found()}>
          {(read) => (
            <article class="ask-answer section-box">
              <p>
                <span class="alert-label">Likely cause</span> {read().likelyCause}
              </p>
              <p>
                <span class="alert-label">Confidence</span> {read().confidence}
              </p>
              <div>
                <span class="alert-label">Evidence</span>
                <ul>
                  <For each={read().evidence}>{(each) => <li>{each.text}</li>}</For>
                </ul>
              </div>
              <div>
                <span class="alert-label">Next steps</span>
                <ul>
                  <For each={read().nextSteps}>{(step) => <li>{step}</li>}</For>
                </ul>
              </div>
              <p class="alert-quiet">
                {read().model} · {spent(read())}
              </p>
            </article>
          )}
        </Show>
      </div>
    </Show>
  )
}
