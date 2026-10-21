# 0057 — A Kafka cluster as it is, found, and a message through it

## Problem

A Kafka store's page shows four sums: messages in, consumer lag, lag growth and under-replicated partitions (spec
0003). When one of them moves, the next question is always where. Which broker is gone, and is it the controller?
Which topic's partitions lost a replica, on which broker, and who leads them now? Which consumer group is behind, on
which partitions, and is it one slow partition or all of them? Today the person looking opens Grafana, or a Kafka UI
with admin rights, or runs `kafka-consumer-groups.sh` from a pod.

The other question is about one message. Someone says *my order never showed up*. Was it written, to which
partition, at which offset? Has each group that reads the topic got past it, and which service handled it, when? The
spans that answer this are already in Tempo, because the estate's producers and consumers are traced. But nothing
puts a span's partition and offset next to where each consumer group is now.

And before any of this, the cluster has to be in the catalog. Each Kafka store is written by hand, with the selector
that picks out its exporter's series, though Prometheus already knows every cluster kafka_exporter scrapes. A cluster
nobody wrote an entry for is not on the page at all.

Simulators such as monedula.dev's Kafka simulator draw a cluster the way people think about it: brokers as columns,
partitions in them with leaders and followers, writes going in, consumer groups reading out with lag. Estate should
draw the real cluster that way, from what the exporters already put in Prometheus. Over that same drawing, it should
show one real message's path from its trace.

## Not doing

- **Simulating anything, yet.** No scenarios, faults, replays or what-ifs here. Every number on the view was read
  from the estate's Prometheus or Tempo at that time, and a number nobody published is not drawn. Replaying the
  cluster's past and asking what if are spec 0058, built on this one.
- **Discovering other engines.** Postgres, MySQL and Redis stores stay written. Kafka is first because its view needs
  the most from the catalog. The same rule can take other engines later, each with the series that names an instance.
- **Talking to Kafka.** Estate reads exporters' series and Tempo's spans. It never connects to a broker, the admin
  API or the controller quorum, and it never reads a message's payload.
- **Administering it.** No reassigning partitions, electing leaders, resetting offsets or killing brokers.
- **History on the cluster view.** It shows now. The stats over a range stay on the charts beside it. A followed
  message shows its own past, from its trace.
- **Messages without traces.** A message whose producer is not traced cannot be followed. Estate does not search a
  topic by key or by offset.

## Shape

### Found, not written

A `kafka:` discover rule, beside spec 0031's `kubernetes:` and spec 0033's `backstage:`, finds every cluster
kafka_exporter is scraped for. It makes each one an ordinary Kafka store:

```yaml
discover:
  - kafka:
      by: [ namespace, strimzi_io_cluster ]   # the labels that tell one cluster from another
      selector: 'job=~"kafka-exporter.*"'     # optional: only these exporters' series
    # What each cluster found becomes. Values may name {label:KEY} for any `by` label; links
    # may also name what a written link does, such as {env}.
    store:
      name: "{label:strimzi_io_cluster}"
      category: Data
      links: { dashboard: "https://grafana.{env}.example/d/kafka?var-cluster={label:strimzi_io_cluster}" }
```

```text
each environment whose sources read Prometheus, every minute, for each kafka rule:
  count by (<by>) (kafka_brokers{<selector>})     one series per cluster
  a cluster is a store: engine kafka, its selector the rule's selector and its `by` labels as matchers,
    named by the rule's `name`, or else by its `by` labels' values joined with `-`
  the same name in several environments is one store in each of them
  checked as a written store is; one with a mistake is left out, named in the log and the doctor
written stores win by name; a Prometheus that does not answer keeps what it last found
```

A found store is marked *found in Prometheus* on its lane and page, and its page offers *Copy as YAML*, as a found
service does. The doctor says per environment what each rule found, what was written over and what was left out.
The catalog check names a `kafka:` rule with no `by`, a `{label:…}` that is not one of its `by` labels, and a `kafka:`
rule with a `service:` in place of a `store:`.

### The cluster

**On a Kafka store's page**, under its health line and above its stats, a panel *The cluster* draws it as a
developer draws one: topics written on the left, the cluster in the middle with each broker holding its partitions,
and the consumer groups reading on the right, joined by flows that move with the messages:

```text
Broker 3 has been gone 9 min; audit 0 has no leader; 7 partitions are under-replicated.
4 brokers · 4 topics · 15 partitions · read 14:26

TOPICS WRITTEN        ┌ KAFKA CLUSTER · 4 BROKERS ────────────────────────────────┐   CONSUMER GROUPS
┌───────────────┐     │ ┌ Broker 0 ┐ ┌ Broker 1 ┐ ┌ Broker 2 ┐ ┆ Broker 3  ┆ ┆No leader┆ │   ┌──────────────────────┐
│ orders 240/s  │ ═══▶│ │ orders 0 │ │ orders 1 │ │ orders 2 │ ┆ gone 9min ┆ ┆ audit 0 ┆ │══▶│ orders-projector     │
└───────────────┘     │ │ orders 3↻│ │ orders 5 │ │payments 1│ ┆           ┆ ┆ offline ┆ │   │ 3 members · 230/s ·  │
┌───────────────┐     │ │payments 3│ │payments 0│ │          │ ┆           ┆ ┆         ┆ │   │ lag 12,410 ▲ 40/s    │
│ payments 35/s │ ──▶ │ └──────────┘ └──────────┘ └──────────┘ ┆           ┆ ┆         ┆ │   └──────────────────────┘
└───────────────┘     └──────────────────────────────────────────────────────────────┘
[orders 0] leader  [orders 1] short of replicas  [audit 0 offline] no leader  ↻ off its preferred broker
```

From kafka_exporter, which every Kafka store already has:

- **Brokers** are boxes in the cluster, from `kafka_broker_info{id,address}`. A broker seen in the last hour that is
  not there now stays as a dashed box marked *gone*, with how long ago.
- **Partitions** sit in their leader's box (`kafka_topic_partition_leader`); those with no leader in a box of their
  own. A partition is amber when it is short of replicas, red when it has no leader, and marked ↻ when its leader is
  not the preferred one. What its marks mean, its in-sync replicas and its offsets are in its words for a screen
  reader.
- **Topics** are cards on the left, every topic the store has, each with its rate in. Internal `__` topics sit behind
  a switch, and a filter box narrows by name. Troubled topics come first, then the busiest.
- **Consumer groups** are cards on the right: members, the messages they read a second, lag, and how fast the lag
  grows over ten minutes. A partition far behind the rest is called out in words.
- **Flows** join each topic to the cluster and the cluster to each group. Their dashes move faster, on a thicker line,
  each time the rate is ten times more, since a cluster's topics run from a message a minute to thousands a second;
  with no messages a flow is still. A group falling behind flows in amber. Nothing moves under reduced motion.
- **Choosing** a group marks the partitions it reads, and choosing a partition marks the groups that read it.
- **Ask AI**, where it is set, reads the cluster as Estate read it and answers in one round with a likely cause, its
  evidence and next steps, at `POST /api/stores/:name/ask?env=`. It shares the alerts' model, day's budget and
  minute's turn; a cluster's brief holds no logs, so one answer serves everyone who asks within the minute.
- On a narrow screen the diagram reads top to bottom, its flows pointing down.

From the JMX exporter, when the store names its series with `jmx:`, the same view fills in what kafka_exporter cannot
say:

- **Followers**, each in its broker's column, from the log each broker holds for a partition (`kafka_log_log_size`
  per broker). A follower is marked in sync or not, by the partition's in-sync count and the broker's
  `UnderReplicated` partitions.
- **The controller quorum**: which broker or controller is active (`ActiveControllerCount`), and which are voters,
  for KRaft or ZooKeeper.
- **Per broker**: bytes in and out a second, requests a second, offline partitions, ISR shrinks and expands a second,
  log size, rack, and the leader epoch of each partition it leads.

**Choosing anything opens its detail** beside the view, or below it on a phone. A broker shows everything read about
it. A partition shows its replicas, epoch, offsets, size and the groups reading it, each with its offset and lag. A
group shows its partitions and members. A topic shows its partitions and its recent messages (below). Choosing a group
marks its partitions in the columns, and choosing a partition marks the groups that read it.

**Words, not only marks**: the panel's first line says what is wrong in a sentence (*broker 3 has been gone 6
minutes; 8 partitions are offline and 4 of orders are under-replicated*). Each mark has its text for a screen reader.
The flow keeps still under `prefers-reduced-motion`.

### A message through it

**Follow a message** takes a trace ID, or a message ID with its topic. Estate searches Tempo for the message's spans
by OpenTelemetry's messaging attributes, and draws the message's path over the cluster:

```text
FOLLOWING 4bf92f35…  order 81723 · key cust-118                                            Open its trace
  petshop       wrote it      09:41:02.114   orders p0 @ 1 882 340, broker 1 leading
  ──▶ orders p0 (broker 1)
  orders-projector  read it   09:41:02.390   by petshop-projector, 276 ms after it was written
  billing           not yet   group at 1 870 940 on p0, 11 400 messages before it, behind by ~4 min at its rate
  audit             read it   09:41:03.002   by audit-sink, 888 ms
```

- **Written**: the producer span (`messaging.operation.type = send`, kind producer) gives the service, topic,
  partition (`messaging.destination.partition.id`), offset (`messaging.kafka.offset`), key and message ID.
- **Read**: each consumer span on the same trace or linked to it (`process` or `receive`, kind consumer) gives the
  group (`messaging.consumer.group.name`), the service and when it happened. A linked trace is found by searching
  Tempo for the message's ID on its topic. A consumer span that names no group is not placed, and the follow says
  which attribute it lacked.
- **Not yet**: for every group the cluster view shows reading that topic with no span for the message, the group's
  committed offset on that partition is compared with the message's offset. This is read live, so *not yet* turns
  into *past it* as the group catches up, and the line says how many messages are still before it and how long that
  should take at the group's rate on that partition. A committed offset is the next one the group reads, so the group
  is past the message once its offset is beyond the message's. A group that reads the topic but has no offset on the
  message's partition is *not known*, not *not yet*.
- On the cluster, the message is a dot in its partition's cell, with a line to each group that read it. Groups
  marked *not yet* are lit amber. Under reduced motion nothing moves, and the words say the same.
- *Open its trace* goes to the trace's page (spec 0046), where the rest of the request around the message is.

A follow has an address, `/stores/:name/messages/:traceId`, so it can be pasted into a chat or an incident.

**A topic's recent messages**, in its detail, are its last 20 producer spans from Tempo: when, who wrote them,
partition, offset and key. Choosing one follows it. They are read when the detail opens and never otherwise.

**Attribute names** follow OpenTelemetry's current messaging conventions. A store may name others, where the
estate's instrumentation is older or its own:

```yaml
stores:
  - name: bus
    engine: kafka
    selector: 'job="kafka"'
    jmx: 'job="kafka-jmx"'                     # optional: followers, controller and per-broker detail
    messages:                                  # optional: where the estate's spans keep these
      offset: messaging.kafka.message.offset
      group: messaging.kafka.consumer.group
```

Each of `system`, `operation`, `topic`, `partition`, `offset`, `key`, `id` and `group` may be named; a Kafka rule's
`store:` may name them for the clusters it finds. The catalog check names `jmx:` or `messages:` on a store whose engine
is not `kafka`.

### Reads

```text
GET /api/store-cluster?env=&store=              brokers, controller, topics, partitions with every replica we
                                                can place, groups; when it was read
GET /api/store-messages?env=&store=&topic=      a topic's recent messages, from Tempo
GET /api/store-message?env=&store=&trace=       a message's spans, and each group's offset on its partition now
GET /api/store-message?env=&store=&id=&topic=
```

The cluster is read every 15 seconds while the panel is open and its tab is seen, and a followed message every 5 seconds
until every group is past it. Nothing is read when the page is not open, so the overview costs no more than it does now.
The cluster's queries are instant queries narrowed by the store's selectors, through a new `instant` on the metrics
source beside `range` and `labels`. A missing JMX exporter leaves those parts out and says so. A missing Tempo turns
*Follow a message* off and says why. The rest of the page is unharmed either way.

## Why this shape

Everything the simulator draws that matters to an operator is already in the estate's exporters: leaders, followers,
the ISR shrinking, a broker gone, the controller, preferred leaders, lag by partition. Drawing those series in the
simulator's layout explains the sums without giving Estate a connection to Kafka. What one message did is already in
its trace. Putting the trace's partition and offset beside each group's committed offset answers *has it been read
yet*, which neither Tempo nor the exporters can answer alone.

The alternative was a Kafka client reading the admin API and the topics themselves. That would place replicas without
JMX and find a message by key without a trace. It would also mean credentials to every cluster, a Kafka client in
Bun, reading payloads, and a second way to read a store. Recommended: exporters and traces only.

## Depends on

- kafka_exporter scraped by the environment's Prometheus, as spec 0003 already reads, with a label that tells one
  cluster from another (Strimzi's `strimzi_io_cluster`, a `cluster` or `namespace` label, or the scrape `job`).
- For followers, the controller and per-broker detail: the JMX exporter with the series names of the common Kafka
  rules (Strimzi's and Bitnami's ship them). Until a store names `jmx:`, those parts say *needs the JMX exporter*.
- For following a message: Tempo, as spec 0046 reads it, and producers and consumers traced with OpenTelemetry's
  messaging attributes, carrying the trace in the message's headers. Until then, the follow says which attribute it
  did not find.

## Stack

- [x] **`discover-kafka-rule`** — `kafka:` and `store:` in a discover rule, and its checks.
      Done when: a rule with no `by`, with `{label:x}` not among its `by`, or with `service:`, is a catalog mistake
      that says so.
- [x] **`discover-kafka`** — every minute, each environment's clusters found from kafka_exporter's series, checked,
      and put after the written stores, which win by name.
      Done when: against the Prometheus stub, two clusters in two environments are two stores in both, each with its
      selector and its template filled; a written store of the same name replaces one; and a failing Prometheus keeps what
      was found.
- [x] **`discover-kafka-page`** — *found in Prometheus* on a found store's lane and page, *Copy as YAML*, and the
      doctor's line.
      Done when: the page suite shows the mark and copies an entry that parses as a catalog store, and the doctor
      names what was found, written over and left out.
- [x] **`instant-readings`** — `instant` on the metrics source: a query now, as each series' labels and value, for
      Prometheus and Grafana's proxy.
      Done when: against the Prometheus stub, an instant query gives labels with numbers, `NaN` and `+Inf` are
      dropped, and a failing source is a `SourceFailure`.
- [x] **`kafka-cluster-read`** — the cluster from kafka_exporter into one shape in `shared`, at
      `GET /api/store-cluster`.
      Done when: against the stub, three brokers with one gone, a partition under-replicated, one without a leader
      and one off its preferred leader all read as such, and a store with no series is a 404 naming why.
- [x] **`kafka-cluster-panel`** — *The cluster* on a Kafka store's page, drawn as a diagram: topics, brokers holding the
      partitions they lead, every topic with the internal switch and the filter, and the sentence of what is wrong.
      Done when: a suite draws the stub's cluster, marks the gone broker, the amber and red partitions and the ↻,
      filters by name, and says the sentence.
- [x] **`kafka-cluster-groups`** — consumer groups with offset and lag per partition, growth, the partition behind
      called out, and choosing a group or a partition marking the other.
      Done when: a suite shows one group with one partition behind called out in words, and choosing it marks its
      partitions above.
- [x] **`kafka-cluster-ask`** — Ask AI on *The cluster*: the cluster as a brief, one round, the answer on the panel.
      Done when: against the exporter and model stubs, the brief names the gone broker, the leaderless partition and
      the lagging group, the answer has its cause, evidence, next steps and cost, and no button shows without Ask AI.
- [ ] **`kafka-cluster-detail`** — the detail beside the view for a broker, partition, group or topic.
      Done when: a suite opens each, and a partition's detail lists the groups reading it with their lag.
- [ ] **`kafka-cluster-jmx`** — `jmx:` on a Kafka store and in a Kafka rule's `store:`, and followers, the controller quorum and per-broker rates
      and sizes from it.
      Done when: against the stub, followers are placed in their brokers' columns, one out of sync is marked, the
      active controller is starred, and a store without `jmx:` says what it would show.
- [x] **`kafka-cluster-flow`** — flows from each topic into the cluster and out to each group, as fast as their rate, still
      under reduced motion; the cluster read again every 15 seconds while the page is open and not otherwise.
      Done when: a suite shows a faster flow for a higher rate and none under reduced motion, and leaving the page
      stops the reads.
- [x] **`span-attributes`** — a trace's spans keep their messaging attributes, and Tempo is searched by them.
      Done when: against the Tempo stub, a producer span reads its topic, partition, offset, key and message ID, and
      a consumer span its group, under the current names or a store's `messages:`.
- [x] **`message-follow-read`** — `GET /api/store-message`: the message's spans, and each group reading the topic
      as read, not yet (with how far before it), or past it.
      Done when: against both stubs, one group read it, one is 11 400 messages before it, and one with no span
      is past its offset and says so.
- [ ] **`message-follow-view`** — *Follow a message*, its address, the path drawn over the cluster, and live
      updates until every group is past it.
      Done when: a suite follows a message, shows the dot and the groups, and a group turns from *not yet* to *past
      it* when the stub's offset moves past.
- [ ] **`topic-recent-messages`** — `GET /api/store-messages` and a topic's recent messages in its detail, each one
      followed when chosen.
      Done when: a suite opens a topic, sees its last messages from the stub, and follows one.
- [ ] **`kafka-cluster-e2e`** — `e2e/tools.ts` answers kafka_exporter's, the JMX exporter's and Tempo's series and
      spans. Playwright opens the Kafka store, sees its brokers, a follower, a group, and follows a message, with
      axe clean.
      Done when: `bunx playwright test` passes with the walk.

## Acceptance

```bash
bun run gate
bunx playwright test
```

With a discover rule and no written Kafka store, the e2e estate's cluster appears on the overview as a store marked
found. Against a real cluster, stopping one broker turns its column to *gone* within a scrape and 15 seconds. The
partitions it led move to the other columns, and its followers turn *out of sync*. Pasting the trace ID of an order
placed in the petshop demo shows the partition and offset it was written to and each group reading the topic, each
turning to *read it* as it is processed.

## Open questions

1. **Discover from Prometheus, or from Strimzi's `Kafka` resources in Kubernetes?** Recommended Prometheus first: it
   finds any cluster with an exporter, wherever it runs (Strimzi, Confluent, MSK with its open monitoring, bare
   VMs). The view reads nothing but those series anyway. Strimzi's resources could add a cluster's version and
   listeners later, through spec 0031's Kubernetes reader.
2. **Where does the panel live?** Recommended on the store's page, above the stats, and not on the overview. The
   overview's lane already says the cluster is unwell, and the view is too wide for a lane.
3. **The JMX exporter's series names.** Recommended the names from the common Kafka rules (Strimzi's and
   Bitnami's), each overridable under `jmx:` if an estate's rules differ. Guessing past those is a step too far.
4. **Follow by key?** Recommended not without a trace. Tempo can search a key attribute, but keys repeat, so a key
   gives a list of the messages written with it in the window, each one followed when chosen. That could come later
   as a search on the topic's detail.
5. **Refresh every 15 seconds, or with the page's other live data?** Recommended its own refresh while open. The
   live stream sends the whole estate to every page, and per-partition data for every cluster would cost each page
   for a panel few of them show.
6. **A group with no span for a message, but past its offset: read or skipped?** Recommended *past it*, not *read
   it*. Estate knows the group's offset moved past, but not that a traced consumer handled it. Untraced and filtered
   consumers look the same from here.
