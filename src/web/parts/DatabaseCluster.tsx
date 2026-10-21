/** @jsxImportSource solid-js */
/**
 * A Postgres or cnpg store's cluster now (spec 0060), in spec 0057's layout: the clients connected on the left, the
 * instances as columns with the primary first, and where the primary's WAL goes on the right. Read when the page
 * opens, and again every 15 seconds while it is open and seen.
 */
import { For, Show } from "solid-js"
import type { PostgresCluster } from "../../shared/postgres-cluster"
import { useEstate } from "../context"
import { behind, databaseWrong, holding, idling, waited } from "../database"
import { clock, duration, measured } from "../format"
import { readEvery } from "../read-every"
import { Flow } from "./KafkaFlow"

type Instance = PostgresCluster["instances"][number]

const roleOf = (instance: Instance) => {
  if (instance.gone !== undefined) return `gone ${duration(instance.gone * 1000)}`
  if (instance.role === "primary") return `primary${instance.promoted === true ? " · promoted in the last hour" : ""}`
  if (instance.role === "replica")
    return `replica${instance.lag === null ? "" : ` · ${waited(instance.lag)} behind`}${(instance.growing ?? 0) > 0 ? " ▲" : ""}`
  return "role not known"
}

const columnClass = (cluster: PostgresCluster, instance: Instance) =>
  instance.gone !== undefined
    ? " gone"
    : behind(cluster, instance)
      ? " attention"
      : instance.role === "primary"
        ? " primary"
        : ""

const Column = (props: { readonly cluster: PostgresCluster; readonly instance: Instance }) => (
  <section class={`kafka-broker${columnClass(props.cluster, props.instance)}`}>
    <h4>{props.instance.name}</h4>
    <p class="muted small flush">{roleOf(props.instance)}</p>
    <Show when={props.instance.connections !== null && props.instance.maxConnections !== null}>
      <meter
        class="database-connections"
        min={0}
        max={props.instance.maxConnections ?? 0}
        high={((props.instance.maxConnections ?? 0) * props.cluster.limits.connections) / 100}
        value={props.instance.connections ?? 0}
        aria-label={`${props.instance.connections} of ${props.instance.maxConnections} connections`}
      />
      <p class="muted small flush">
        {props.instance.connections} / {props.instance.maxConnections} connections
        {(props.instance.waiting ?? 0) > 0 ? ` · ${props.instance.waiting} waiting on a lock` : ""}
      </p>
    </Show>
    <Show when={props.instance.role === "primary" && props.instance.gone === undefined}>
      <div class="kafka-chips database-sizes">
        <For each={props.cluster.databases}>
          {(database) => (
            <span class="kafka-chip">
              {database.name} {measured(database.size, "bytes")}
            </span>
          )}
        </For>
      </div>
    </Show>
  </section>
)

/** Each place the primary's WAL goes: its streaming replicas, its slots, the archive and the last base backup. */
const targetsOf = (cluster: PostgresCluster) => {
  const named = new Map(cluster.instances.map((instance) => [instance.name, instance]))
  const late = (name: string) => {
    const instance = named.get(name)
    return instance !== undefined && behind(cluster, instance)
  }
  return [
    ...cluster.streaming.map((replica) => ({
      title: replica.name,
      line: `streaming${replica.sync === null ? "" : ` · ${replica.sync}`} · ${measured(replica.behind, "bytes")} to replay`,
      amber: late(replica.name),
    })),
    ...cluster.slots.map((slot) => ({
      title: `slot ${slot.name}`,
      line: `${slot.active ? "active" : "inactive"} · holds ${measured(slot.retained, "bytes")}`,
      amber: holding(slot),
    })),
    ...(cluster.archive === null
      ? []
      : [
          {
            title: "WAL archive",
            line: `${cluster.archive.since === null ? "no segment yet" : `last segment ${waited(cluster.archive.since)} ago`}${(cluster.archive.failed ?? 0) > 0 ? " · failing" : ""}`,
            amber: (cluster.archive.failed ?? 0) > 0,
          },
        ]),
    ...(cluster.backup === null
      ? []
      : [{ title: "Base backup", line: `${duration(cluster.backup * 1000)} ago`, amber: cluster.backup > 86_400 }]),
  ]
}

const Drawn = (props: { readonly cluster: PostgresCluster }) => {
  const up = () => props.cluster.instances.filter((instance) => instance.gone === undefined)
  return (
    <>
      <p class="lede measure flush">{databaseWrong(props.cluster)}</p>
      <p class="muted small flush">
        {up().length} instance{up().length === 1 ? "" : "s"} up · {props.cluster.databases.length} database
        {props.cluster.databases.length === 1 ? "" : "s"}
        {props.cluster.version === null ? "" : ` · Postgres ${props.cluster.version}`} · read{" "}
        {clock(props.cluster.readAt)}
      </p>
      <div class="kafka-diagram">
        <div class="kafka-side kafka-in">
          <h3 class="kafka-label">Connected from</h3>
          <Show
            when={props.cluster.clients.length > 0}
            fallback={<p class="muted small flush">No clients reported.</p>}
          >
            <ul class="kafka-list">
              <For each={props.cluster.clients}>
                {(client) => (
                  <li class="kafka-row">
                    <span class={`kafka-card${idling(client) ? " attention" : ""}`}>
                      <strong>{client.name}</strong>{" "}
                      <span class="kafka-card-line">
                        {client.connections} connections · {client.active} active
                      </span>{" "}
                      <Show when={idling(client)}>
                        <span class="kafka-card-line">idle in a transaction for {waited(client.longestIdle ?? 0)}</span>
                      </Show>
                    </span>
                    <Flow rate={null} />
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
        <section
          class="kafka-cluster"
          aria-label={`Postgres cluster, ${props.cluster.instances.length} instance${props.cluster.instances.length === 1 ? "" : "s"}`}
        >
          <h3 class="kafka-label">
            Postgres{props.cluster.version === null ? "" : ` ${props.cluster.version}`} ·{" "}
            {props.cluster.instances.length} instance{props.cluster.instances.length === 1 ? "" : "s"}
          </h3>
          <div class="kafka-brokers">
            <For each={props.cluster.instances}>
              {(instance) => <Column cluster={props.cluster} instance={instance} />}
            </For>
          </div>
        </section>
        <div class="kafka-side kafka-out">
          <h3 class="kafka-label">WAL goes to</h3>
          <Show
            when={targetsOf(props.cluster).length > 0}
            fallback={<p class="muted small flush">Nothing reported.</p>}
          >
            <ul class="kafka-list">
              <For each={targetsOf(props.cluster)}>
                {(target) => (
                  <li class="kafka-row">
                    <Flow rate={null} behind={target.amber} />
                    <span class={`kafka-card${target.amber ? " attention" : ""}`}>
                      <strong>{target.title}</strong> <span class="kafka-card-line">{target.line}</span>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
      <div class="kafka-key">
        <span class="database-key primary">primary</span>
        <span class="database-key">replica</span>
        <span class="database-key attention">behind or near a limit</span>
        <span class="database-key gone">gone</span>
      </div>
      <Show when={props.cluster.missing.length > 0}>
        <ul class="muted small reasons">
          <For each={props.cluster.missing}>{(part) => <li>{part.charAt(0).toUpperCase() + part.slice(1)}.</li>}</For>
        </ul>
      </Show>
    </>
  )
}

/** How often the cluster is read again while its page is open. */
const every = 15_000

export const DatabasePanel = (props: { readonly store: string; readonly every?: number }) => {
  const { actions } = useEstate()
  const cluster = readEvery(
    () => props.store,
    (store) => actions.databaseCluster(store),
    () => props.every ?? every,
  )
  const drawn = () => {
    const read = cluster()
    return typeof read === "string" ? undefined : read
  }
  return (
    <section aria-labelledby="store-cluster" class="panel section-box stack kafka-panel">
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
