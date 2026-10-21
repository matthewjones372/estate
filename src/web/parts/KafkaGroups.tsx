/** @jsxImportSource solid-js */
/**
 * A Kafka cluster's consumer groups (spec 0057), on the diagram's right: each group's members, lag and its growth, a
 * flow out of the cluster as fast as it reads, and a partition far behind the rest called out. Choosing a group marks
 * the partitions it reads. With a message followed, each group says whether it has read it, one not yet in amber.
 */
import { For, Show } from "solid-js"
import type { KafkaCluster } from "../../shared/kafka-cluster"
import type { FollowedMessage } from "../../shared/kafka-message"
import { measured } from "../format"
import { behindWords } from "../kafka"
import { stateWords } from "../kafka-message"
import { Flow } from "./KafkaFlow"

type Group = KafkaCluster["groups"][number]

/** What the person chose: a group, whose partitions are marked, or a partition, whose groups are. */
export type Chosen = { readonly group: string } | { readonly topic: string; readonly partition: number } | undefined

export const reads = (group: Group, topic: string, partition: number) =>
  group.partitions.some((each) => each.topic === topic && each.partition === partition)

const lagging = (group: Group) => (group.growing ?? 0) > 0 || behindWords(group) !== undefined

type Following = FollowedMessage["groups"][number]

/** How a group's card is marked for the message: read it, waiting for it, or past it. */
const followClass = (following: Following | undefined) => {
  if (following === undefined) return ""
  switch (following.state) {
    case "read":
      return " carried"
    case "not yet":
    case "unknown":
      return " waiting"
    case "past it":
      return " passed"
  }
}

export const Groups = (props: {
  readonly groups: KafkaCluster["groups"]
  readonly chosen: Chosen
  readonly choose: (chosen: Chosen) => void
  readonly followed?: FollowedMessage["groups"] | undefined
}) => {
  const following = (group: Group) => props.followed?.find((each) => each.name === group.name)
  const waiting = (group: Group) => {
    const state = following(group)?.state
    return state === "not yet" || state === "unknown"
  }
  const isChosen = (group: Group) =>
    props.chosen !== undefined && "group" in props.chosen && props.chosen.group === group.name
  const marked = (group: Group) =>
    isChosen(group) ||
    (props.chosen !== undefined && "topic" in props.chosen && reads(group, props.chosen.topic, props.chosen.partition))
  return (
    <div class="kafka-side kafka-out">
      <h3 class="kafka-label">Consumer groups</h3>
      <Show when={props.groups.length > 0} fallback={<p class="muted small flush">No group reads this cluster.</p>}>
        <ul class="kafka-list">
          <For each={props.groups}>
            {(group) => (
              <li class="kafka-row">
                <Flow
                  rate={group.rate}
                  behind={lagging(group) || waiting(group)}
                  carrying={following(group)?.state === "read"}
                />
                <button
                  type="button"
                  class={`kafka-card${lagging(group) ? " attention" : ""}${marked(group) ? " marked" : ""}${followClass(following(group))}`}
                  aria-pressed={isChosen(group)}
                  onClick={() => props.choose(isChosen(group) ? undefined : { group: group.name })}
                >
                  <strong>{group.name}</strong>{" "}
                  <span class="kafka-card-line">
                    {group.members ?? "?"} member{group.members === 1 ? "" : "s"} · {measured(group.rate, "/s")} · lag{" "}
                    {group.lag === null ? "unknown" : group.lag.toLocaleString("en-GB")}
                    {(group.growing ?? 0) > 0 ? ` ▲ ${measured(group.growing, "/s")}` : ""}
                  </span>{" "}
                  <Show when={behindWords(group)}>{(words) => <span class="kafka-card-line">{words()}</span>}</Show>
                  <Show when={following(group)}>
                    {(each) => <span class="kafka-card-line kafka-follow-state">{stateWords(each())}</span>}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
