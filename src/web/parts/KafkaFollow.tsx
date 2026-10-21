/** @jsxImportSource solid-js */
/**
 * *Follow a message* on a Kafka store's cluster (spec 0057): a trace ID taken to the follow's own address, the message
 * read every 5 seconds until every group is past it, and its path in words above the diagram that marks it.
 */
import { type Accessor, createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { KafkaCluster } from "../../shared/kafka-cluster"
import type { FollowedMessage } from "../../shared/kafka-message"
import { useEstate } from "../context"
import { followSaid, pathWords } from "../kafka-message"
import { pathOf } from "../route"
import { A } from "./A"

/** How often a followed message is read again, until every group is past it. */
const every = 5_000

/** The message followed by this trace, read again until it is done; undefined while none is followed. */
export const useFollowed = (
  store: Accessor<string>,
  trace: Accessor<string | undefined>,
  often = every,
): Accessor<FollowedMessage | string | undefined> => {
  const { actions } = useEstate()
  const [followed, setFollowed] = createSignal<FollowedMessage | string | undefined>()
  createEffect(
    on([store, trace], ([store, trace]) => {
      setFollowed(trace === undefined ? undefined : "Following the message…")
      if (trace === undefined) return
      let current = true
      let timer: ReturnType<typeof setTimeout> | undefined
      // A read again keeps what is drawn until it answers, and a failure in between leaves it drawn.
      const read = (again: boolean) =>
        void actions.storeMessage(store, trace).then((answer) => {
          if (!current) return
          if (!again || typeof answer !== "string") setFollowed(answer)
          if (typeof answer === "string" ? !again : answer.done) return
          next()
        })
      const next = () => {
        timer = setTimeout(() => (document.visibilityState === "hidden" ? next() : read(true)), often)
      }
      read(false)
      onCleanup(() => {
        current = false
        clearTimeout(timer)
      })
    }),
  )
  return followed
}

/** The trace ID to follow, taken to the follow's address so it can be pasted into a chat or an incident. */
export const FollowForm = (props: { readonly store: string; readonly message: string | undefined }) => {
  const { actions } = useEstate()
  const [typed, setTyped] = createSignal(props.message ?? "")
  const follow = (event: Event) => {
    event.preventDefault()
    const trace = typed().trim()
    if (trace !== "") actions.navigate(pathOf({ page: "store", name: props.store, message: trace }))
  }
  return (
    <form class="kafka-follow" onSubmit={follow}>
      <label class="kafka-follow-field">
        <span class="kafka-label">Follow a message</span>
        <input
          type="text"
          name="trace"
          class="select"
          placeholder="Trace ID"
          autocomplete="off"
          spellcheck={false}
          value={typed()}
          onInput={(event) => setTyped(event.currentTarget.value)}
        />
      </label>
      <button type="submit" class="primary-button">
        Follow
      </button>
      <Show when={props.message !== undefined}>
        <A to={pathOf({ page: "store", name: props.store })}>Stop following</A>
      </Show>
    </form>
  )
}

/** The message's path in words, and whether every group has it, as read when last asked. */
export const FollowedPath = (props: {
  readonly followed: FollowedMessage | string
  readonly cluster: KafkaCluster | undefined
}) => (
  <Show
    when={typeof props.followed === "string" ? undefined : (props.followed as FollowedMessage)}
    fallback={<p class="muted flush">{props.followed as string}</p>}
  >
    {(followed) => (
      <section class="kafka-followed" aria-label={`Following ${followed().trace}`}>
        <p class="kafka-follow-said flush" aria-live="polite">
          {followSaid(followed())}
        </p>
        <ol class="kafka-path">
          <For each={pathWords(followed(), props.cluster)}>{(step) => <li>{step}</li>}</For>
        </ol>
        <Show when={followed().missing.length > 0}>
          <p class="muted small flush">
            A consumer span named no {followed().missing.join(" or ")}, so it is in no group here.
          </p>
        </Show>
        <A to={pathOf({ page: "trace", id: followed().trace })}>Open its trace</A>
      </section>
    )}
  </Show>
)
