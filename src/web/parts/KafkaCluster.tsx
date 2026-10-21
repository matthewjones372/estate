/** @jsxImportSource solid-js */
/**
 * A Kafka store's cluster now (spec 0057), drawn as a developer draws one: topics flowing in on the left, the cluster
 * with each broker holding the partitions it leads, and the consumer groups reading out on the right. Each flow moves
 * as fast as its messages a second. Read when the page opens, and again every 15 seconds while it is open and seen.
 * A followed message is a dot in its partition, and each group is marked with whether it has read it.
 */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import { type KafkaCluster, type Partition, troubled } from "../../shared/kafka-cluster"
import type { FollowedMessage, Written } from "../../shared/kafka-message"
import { useEstate } from "../context"
import { clock, duration, measured } from "../format"
import { internal, whatIsWrong } from "../kafka"
import { ClusterAsk } from "./KafkaAsk"
import { Flow } from "./KafkaFlow"
import { FollowedPath, FollowForm, useFollowed } from "./KafkaFollow"
import { type Chosen, Groups, reads } from "./KafkaGroups"

const number = (value: number) => value.toLocaleString("en-GB")

const stateOf = (partition: Partition) =>
  partition.leader === null ? "critical" : troubled(partition) ? "attention" : "well"

/** What a partition's marks mean, in words, for a screen reader. */
const saidOf = (topic: string, partition: Partition) =>
  [
    `partition ${partition.id} of ${topic}:`,
    [
      partition.leader === null ? "no leader" : undefined,
      partition.inSync === null || partition.replicas === null
        ? undefined
        : `${partition.inSync} of ${partition.replicas} replicas in sync`,
      partition.preferred === false ? "not on its preferred leader" : undefined,
      partition.oldest === null || partition.newest === null
        ? undefined
        : `offsets ${number(partition.oldest)} to ${number(partition.newest)}`,
    ]
      .filter((each) => each !== undefined)
      .join(", "),
  ].join(" ")

interface Led {
  readonly topic: string
  readonly partition: Partition
}

/** The offset of the followed message, where this is the partition it was written to. */
const carried = (led: Led, written: Written | undefined) =>
  written !== undefined && written.topic === led.topic && written.partition === led.partition.id
    ? written.offset
    : undefined

const Chip = (props: {
  readonly led: Led
  readonly marked: boolean
  readonly choose: () => void
  readonly written: Written | undefined
}) => (
  <button
    type="button"
    class={`kafka-chip ${stateOf(props.led.partition)}${props.marked ? " marked" : ""}${carried(props.led, props.written) === undefined ? "" : " carrying"}`}
    aria-pressed={props.marked}
    onClick={() => props.choose()}
  >
    <span aria-hidden="true">
      {props.led.topic} {props.led.partition.id}
      {props.led.partition.leader === null ? " offline" : props.led.partition.preferred === false ? " ↻" : ""}
    </span>
    <Show when={carried(props.led, props.written)}>
      {(offset) => (
        <>
          <span class="kafka-dot" aria-hidden="true" />
          <span class="visually-hidden">holds the message followed, at offset {number(offset())}; </span>
        </>
      )}
    </Show>
    <span class="visually-hidden">{saidOf(props.led.topic, props.led.partition)}</span>
  </button>
)

const Drawn = (props: { readonly cluster: KafkaCluster; readonly followed: FollowedMessage | undefined }) => {
  const written = () => props.followed?.written
  const [filter, setFilter] = createSignal("")
  const [showInternal, setShowInternal] = createSignal(false)
  const [chosen, setChosen] = createSignal<Chosen>(undefined)
  const isChosen = (led: Led) => {
    const now = chosen()
    if (now === undefined) return false
    if ("topic" in now) return now.topic === led.topic && now.partition === led.partition.id
    const group = props.cluster.groups.find((each) => each.name === now.group)
    return group !== undefined && reads(group, led.topic, led.partition.id)
  }
  const choose = (led: Led) =>
    setChosen(
      isChosen(led) && "topic" in (chosen() ?? {}) ? undefined : { topic: led.topic, partition: led.partition.id },
    )
  const topics = () =>
    props.cluster.topics.filter(
      (topic) => (showInternal() || !internal(topic.name)) && topic.name.includes(filter().trim()),
    )
  const counted = () => props.cluster.topics.filter((topic) => !internal(topic.name))
  const led = (leader: string | null): ReadonlyArray<Led> =>
    topics().flatMap((topic) =>
      topic.partitions
        .filter((partition) => partition.leader === leader)
        .map((partition) => ({ topic: topic.name, partition })),
    )
  // Brokers, then any leader the exporter named but did not list.
  const brokers = () => {
    const listed = props.cluster.brokers
    const leaders = props.cluster.topics.flatMap((topic) => topic.partitions.map((partition) => partition.leader))
    const unlisted = [...new Set(leaders.filter((id): id is string => id !== null && !listed.some((b) => b.id === id)))]
    return [...listed, ...unlisted.map((id) => ({ id, leads: 0 }))]
  }
  return (
    <>
      <p class="lede measure flush">{whatIsWrong(props.cluster)}</p>
      <p class="muted small flush">
        {props.cluster.brokers.length} brokers · {counted().length} topics ·{" "}
        {counted().reduce((sum, topic) => sum + topic.partitions.length, 0)} partitions · read{" "}
        {clock(props.cluster.readAt)}
      </p>
      <div class="kafka-diagram">
        <div class="kafka-side kafka-in">
          <h3 class="kafka-label">Topics written</h3>
          <ul class="kafka-list">
            <For each={topics()}>
              {(topic) => (
                <li class="kafka-row">
                  <span
                    class={`kafka-card${topic.partitions.some(troubled) ? " attention" : ""}${written()?.topic === topic.name ? " carrying" : ""}`}
                  >
                    <strong>{topic.name}</strong>{" "}
                    <span class="kafka-card-line">
                      {measured(topic.rate, "/s")} · {topic.partitions.length} partitions
                    </span>
                  </span>
                  <Flow rate={topic.rate} />
                </li>
              )}
            </For>
          </ul>
        </div>
        <section class="kafka-cluster" aria-label={`Kafka cluster, ${props.cluster.brokers.length} brokers`}>
          <h3 class="kafka-label">Kafka cluster · {props.cluster.brokers.length} brokers</h3>
          <div class="kafka-brokers">
            <For each={brokers()}>
              {(broker) => (
                <section class={`kafka-broker${"gone" in broker && broker.gone !== undefined ? " gone" : ""}`}>
                  <h4>Broker {broker.id}</h4>
                  <p class="muted small flush">
                    {"gone" in broker && broker.gone !== undefined
                      ? `gone ${duration(broker.gone * 1000)}`
                      : (("address" in broker ? broker.address : undefined) ?? "not listed")}
                  </p>
                  <div class="kafka-chips">
                    <For each={led(broker.id)}>
                      {(each) => (
                        <Chip led={each} marked={isChosen(each)} choose={() => choose(each)} written={written()} />
                      )}
                    </For>
                  </div>
                </section>
              )}
            </For>
            <Show when={led(null).length > 0}>
              <section class="kafka-broker none">
                <h4>No leader</h4>
                <p class="muted small flush">offline</p>
                <div class="kafka-chips">
                  <For each={led(null)}>
                    {(each) => (
                      <Chip led={each} marked={isChosen(each)} choose={() => choose(each)} written={written()} />
                    )}
                  </For>
                </div>
              </section>
            </Show>
          </div>
        </section>
        <Groups groups={props.cluster.groups} chosen={chosen()} choose={setChosen} followed={props.followed?.groups} />
      </div>
      <div class="kafka-key">
        <span class="kafka-chip well" aria-hidden="true">
          orders 0
        </span>{" "}
        leader
        <span class="kafka-chip attention" aria-hidden="true">
          orders 1
        </span>{" "}
        short of replicas
        <span class="kafka-chip critical" aria-hidden="true">
          audit 0 offline
        </span>{" "}
        no leader
        <span>↻ off its preferred broker</span>
        <span>flows move faster the more messages a second</span>
        <input
          type="search"
          class="select"
          placeholder="Filter topics"
          aria-label="Filter topics"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <label>
          <input type="checkbox" checked={showInternal()} onChange={() => setShowInternal(!showInternal())} /> Show
          internal topics
        </label>
      </div>
    </>
  )
}

/** How often the cluster is read again while its page is open. */
const every = 15_000

export const ClusterPanel = (props: {
  readonly store: string
  readonly every?: number
  /** The trace of a message followed through it. */
  readonly message?: string | undefined
}) => {
  const { actions } = useEstate()
  const followed = useFollowed(
    () => props.store,
    () => props.message,
  )
  const [cluster, setCluster] = createSignal<KafkaCluster | string | "loading">("loading")
  createEffect(
    on(
      () => props.store,
      (store) => {
        let current = true
        let readAt = 0
        const often = props.every ?? every
        setCluster("loading")
        // A read again keeps what is drawn until it answers, and a failure in between leaves it drawn.
        const read = (again: boolean) => {
          readAt = Date.now()
          void actions.storeCluster(store).then((answer) => {
            if (current && (!again || typeof answer !== "string")) setCluster(answer)
          })
        }
        const visible = () => document.visibilityState !== "hidden"
        read(false)
        // Read again while someone can see it, and on coming back to a tab left longer than that.
        const timer = setInterval(() => visible() && read(true), often)
        const back = () => visible() && Date.now() - readAt >= often && read(true)
        document.addEventListener("visibilitychange", back)
        onCleanup(() => {
          current = false
          clearInterval(timer)
          document.removeEventListener("visibilitychange", back)
        })
      },
    ),
  )
  const marked = () => {
    const message = followed()
    return typeof message === "string" ? undefined : message
  }
  const drawn = () => {
    const read = cluster()
    return typeof read === "string" ? undefined : read
  }
  return (
    <section aria-labelledby="store-cluster" class="panel section-box stack kafka-panel">
      <h2 id="store-cluster" class="section-title">
        The cluster
      </h2>
      <ClusterAsk store={props.store} />
      <FollowForm store={props.store} message={props.message} />
      <Show when={followed()}>{(read) => <FollowedPath followed={read()} cluster={drawn()} />}</Show>
      <Show
        when={drawn()}
        fallback={<p class="muted flush">{cluster() === "loading" ? "Reading the cluster…" : (cluster() as string)}</p>}
      >
        {(read) => <Drawn cluster={read()} followed={marked()} />}
      </Show>
    </section>
  )
}
