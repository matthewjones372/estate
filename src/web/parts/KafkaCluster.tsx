/** @jsxImportSource solid-js */
/**
 * A Kafka store's cluster now (spec 0057): its brokers as columns, each topic a row with its partitions in their
 * leader's column, and what is wrong in a sentence. Read when the page opens, never otherwise.
 */
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js"
import { type KafkaCluster, type Partition, troubled } from "../../shared/kafka-cluster"
import { useEstate } from "../context"
import { clock, duration, measured } from "../format"
import { internal, whatIsWrong } from "../kafka"

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

const Pips = (props: { readonly partition: Partition }) => (
  <span class="pips" aria-hidden="true">
    <For each={Array.from({ length: props.partition.replicas ?? 0 }, (_, index) => index)}>
      {(index) => <i class={index < (props.partition.inSync ?? 0) ? "pip on" : "pip"} />}
    </For>
  </span>
)

const Chip = (props: { readonly topic: string; readonly partition: Partition }) => (
  <span class={`partition ${stateOf(props.partition)}`}>
    <span aria-hidden="true">
      p{props.partition.id} <Pips partition={props.partition} />
      {props.partition.inSync ?? "?"}/{props.partition.replicas ?? "?"}
      {props.partition.preferred === false ? " ↻" : ""}
    </span>
    <span class="visually-hidden">{saidOf(props.topic, props.partition)}</span>
  </span>
)

const Drawn = (props: { readonly cluster: KafkaCluster }) => {
  const [filter, setFilter] = createSignal("")
  const [showInternal, setShowInternal] = createSignal(false)
  const topics = () =>
    props.cluster.topics.filter(
      (topic) => (showInternal() || !internal(topic.name)) && topic.name.includes(filter().trim()),
    )
  const counted = () => props.cluster.topics.filter((topic) => !internal(topic.name))
  // Brokers, then any leader the exporter named but did not list, then a column for partitions with none.
  const columns = () => {
    const listed = props.cluster.brokers.map((broker) => broker.id)
    const leaders = props.cluster.topics.flatMap((topic) => topic.partitions.map((partition) => partition.leader))
    const unlisted = [...new Set(leaders.filter((id): id is string => id !== null && !listed.includes(id)))]
    return [...listed, ...unlisted, ...(leaders.includes(null) ? [null] : [])]
  }
  const brokerOf = (id: string) => props.cluster.brokers.find((broker) => broker.id === id)
  return (
    <>
      <p class="muted flush">
        {props.cluster.brokers.length} brokers · {counted().length} topics ·{" "}
        {counted().reduce((sum, topic) => sum + topic.partitions.length, 0)} partitions · read{" "}
        {clock(props.cluster.readAt)}
      </p>
      <p class="lede measure">{whatIsWrong(props.cluster)}</p>
      <div class="cluster-tools">
        <input
          type="search"
          class="select"
          placeholder="Filter topics"
          aria-label="Filter topics"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <label class="muted small">
          <input type="checkbox" checked={showInternal()} onChange={() => setShowInternal(!showInternal())} /> Show
          internal topics
        </label>
      </div>
      <section class="table-scroll" aria-label="Partitions by the broker that leads them" tabindex="0">
        <table class="cluster">
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <For each={columns()}>
                {(id) => (
                  <th scope="col" class={id !== null && brokerOf(id)?.gone !== undefined ? "gone" : undefined}>
                    <Show when={id} fallback="No leader">
                      {(named) => (
                        <>
                          broker {named()} <span class="muted mono small">{brokerOf(named())?.address ?? ""}</span>{" "}
                          <span class="muted small">
                            {brokerOf(named())?.gone === undefined
                              ? `leads ${brokerOf(named())?.leads ?? 0}`
                              : `gone ${duration((brokerOf(named())?.gone ?? 0) * 1000)}`}
                          </span>
                        </>
                      )}
                    </Show>
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={topics()}>
              {(topic) => (
                <tr>
                  <th scope="row">
                    {topic.name}{" "}
                    <span class="muted small">
                      {measured(topic.rate, "/s")} · {topic.partitions.length} partitions
                    </span>
                  </th>
                  <For each={columns()}>
                    {(id) => (
                      <td>
                        <For each={topic.partitions.filter((partition) => partition.leader === id)}>
                          {(partition) => <Chip topic={topic.name} partition={partition} />}
                        </For>
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>
    </>
  )
}

export const ClusterPanel = (props: { readonly store: string }) => {
  const { actions } = useEstate()
  const [cluster, setCluster] = createSignal<KafkaCluster | string | "loading">("loading")
  createEffect(
    on(
      () => props.store,
      (store) => {
        let current = true
        setCluster("loading")
        void actions.storeCluster(store).then((read) => {
          if (current) setCluster(read)
        })
        onCleanup(() => {
          current = false
        })
      },
    ),
  )
  const drawn = () => {
    const read = cluster()
    return typeof read === "string" ? undefined : read
  }
  return (
    <section aria-labelledby="store-cluster" class="panel section-box stack">
      <h2 id="store-cluster" class="section-title">
        The cluster
      </h2>
      <Show
        when={drawn()}
        fallback={<p class="muted flush">{cluster() === "loading" ? "Reading the cluster…" : (cluster() as string)}</p>}
      >
        {(read) => <Drawn cluster={read()} />}
      </Show>
    </section>
  )
}
