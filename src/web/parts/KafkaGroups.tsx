/** @jsxImportSource solid-js */
/**
 * A Kafka cluster's consumer groups (spec 0057), on the diagram's right: each group's members, lag and its growth, a
 * flow out of the cluster as fast as it reads, and a partition far behind the rest called out. Choosing a group marks
 * the partitions it reads.
 */
import { For, Show } from "solid-js"
import type { KafkaCluster } from "../../shared/kafka-cluster"
import { measured } from "../format"
import { behindWords } from "../kafka"
import { Flow } from "./KafkaFlow"

type Group = KafkaCluster["groups"][number]

/** What the person chose: a group, whose partitions are marked, or a partition, whose groups are. */
export type Chosen = { readonly group: string } | { readonly topic: string; readonly partition: number } | undefined

export const reads = (group: Group, topic: string, partition: number) =>
  group.partitions.some((each) => each.topic === topic && each.partition === partition)

const lagging = (group: Group) => (group.growing ?? 0) > 0 || behindWords(group) !== undefined

export const Groups = (props: {
  readonly groups: KafkaCluster["groups"]
  readonly chosen: Chosen
  readonly choose: (chosen: Chosen) => void
}) => {
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
                <Flow rate={group.rate} behind={lagging(group)} />
                <button
                  type="button"
                  class={`kafka-card${lagging(group) ? " attention" : ""}${marked(group) ? " marked" : ""}`}
                  aria-pressed={isChosen(group)}
                  onClick={() => props.choose(isChosen(group) ? undefined : { group: group.name })}
                >
                  <strong>{group.name}</strong>{" "}
                  <span class="kafka-card-line">
                    {group.members ?? "?"} member{group.members === 1 ? "" : "s"} · {measured(group.rate, "/s")} · lag{" "}
                    {group.lag.toLocaleString("en-GB")}
                    {(group.growing ?? 0) > 0 ? ` ▲ ${measured(group.growing, "/s")}` : ""}
                  </span>{" "}
                  <Show when={behindWords(group)}>{(words) => <span class="kafka-card-line">{words()}</span>}</Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}
