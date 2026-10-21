# 0058 — A change to a Kafka cluster, before it is made

## Problem

Changes to a Kafka cluster are where its outages come from. Adding partitions to a keyed topic moves keys and
breaks their order. A rolling restart with a topic at `min.insync.replicas` equal to its in-sync count stops every
`acks=all` producer for that topic while one broker is down. Scaling a consumer group past its partitions leaves
members idle. Scaling it down triples one member's lag. Shortening retention on a topic a group is behind on deletes
messages the group has not read. Taking a broker out leaves the partitions it led to whoever is next.

The person making the change works this out in their head, from `kafka-topics.sh --describe` and a Grafana board,
and finds out what they missed from the alerts afterwards. Spec 0057 draws the cluster as it is, from the exporters.
That is the state a change starts from, and nobody has to type it in.

Simulators such as monedula.dev's Kafka simulator step a made-up cluster through faults and say what each step did.
Estate should step the estate's own cluster through a change someone is about to make, from its real brokers,
leaders, replicas, rates and lag. It should also say which of the estate's services would feel it.

## Not doing

- **Making the change.** Estate does not apply anything to Kafka, open a pull request or edit a resource. The result
  is something to read before doing it, and to paste into the change's review.
- **Predicting load.** The rates are those of the last hour, held steady, or scaled by a factor the person sets.
  Estate does not forecast traffic.
- **The network, the disks and the JVM.** No latency model, page cache, GC or request queues. A step takes the
  time the person's inputs say it does, such as how long a broker takes to restart, and the report says it assumed
  that.
- **Kafka's every rule.** The model covers what decides availability, ordering, lag and retention: leaders,
  in-sync replicas against `min.insync.replicas`, preferred leaders, key-to-partition hashing, assignment by the
  group's assignor, and retention against each group's offset. Quotas, transactions and tiered storage are out.
- **A sandbox with made-up clusters.** The model always starts from a real cluster Estate has read. A blank cluster
  to play with is what the simulators online are for.

## Shape

### Asking what if

On a Kafka store's page, *The cluster* (spec 0057) gets **What if…**, which opens a change beside the view:

```text
WHAT IF…                                                         starting from the cluster read 09:41:02
  [ Restart brokers one by one ▾ ]   brokers 1, 2, 3 · 90 s each · wait for in sync between
  topics' settings      orders min.insync.replicas [2]   acks [all]      ← from the cluster where known, else asked
  load                  as the last hour ×[1.0]
                                                                         [ Run it ]
```

The changes, each with what it needs:

| Change | Inputs |
|---|---|
| Restart brokers one by one | which brokers, how long each is down, whether to wait for in sync between them |
| Take a broker out, or lose one | which broker, for good or for how long |
| Add a broker | how many; partitions stay where they are until a reassignment is asked for too |
| Reassign partitions | to a broker set, or *balance leaders and replicas*; throttle in MB/s |
| Add partitions to a topic | the new count; whether its producers key their messages |
| Change replication factor or `min.insync.replicas` | the topic and the new value |
| Change retention | the topic and the new time or size |
| Scale a consumer group | the new member count; its assignor (cooperative-sticky, range, round-robin) |
| Change the load | a factor on a topic's rate in, or on a group's processing rate |

Several changes can be stacked into one plan, each starting where the last one ended, as a change usually is in
practice. A topic's settings that no exporter publishes, such as `min.insync.replicas`, `acks` and retention, are
asked for, filled with Kafka's defaults, and named in the report as assumed. A store's catalog entry may write them
once under `settings:`, so they are not asked for again.

### What it says

The run is stepped like a simulator, with a caption for every step, and its result reads first:

```text
RESTART BROKERS 1, 2, 3 ONE BY ONE                                  run from the cluster at 09:41:02
✗ orders stops taking writes for 90 s while broker 2 is down: p1 and p4 have 2 in sync, min.insync.replicas 2,
  and broker 2 is one of them. checkout and payments write to orders with acks=all.
⚠ orders-projector's lag peaks at 31 000 (now 12 400), back under 1 000 after 6 min.
✓ No messages are lost. No retention deletes unread messages.

  t+0s     broker 1 stops. It led 48 partitions; 48 leaders move to brokers 2 and 3. 48 partitions under-replicated.
  t+90s    broker 1 is back. Followers catching up at 40 MB/s.
  t+212s   broker 1 is in sync on every partition. Leaders stay on 2 and 3 until a preferred election.
  t+212s   broker 2 stops. orders p1 and p4 fall to 1 in sync, under min.insync.replicas 2: writes refused.
  …
  [ ◀ ] [ ▶ ] step ·  the cluster view above shows each step, with what changed marked
```

- **The verdict lines** come first: ✗ for writes refused, a partition with no leader, messages deleted before a
  group read them, or keys moved to another partition; ⚠ for lag that grows, a member idle, or a broker over twice
  the cluster's mean in leaders or bytes; ✓ for what was checked and came through. Each names the topics, partitions
  and groups, and how long.
- **Who would feel it**: the services that write to or read from each topic in a ✗ or ⚠ line. These come from the
  traces' messaging spans (spec 0057), from the catalog map's edges to the store, and from each group's name where it
  matches a service. Each is linked, and the report says which of the three it used.
- **The steps** drive *The cluster* view: it shows the simulated cluster at the step chosen, marked *what if* in its
  heading and border so it is never mistaken for now, with what the step changed outlined.
- **Before and after**: leaders, replicas and bytes per broker, partitions per group member, and each topic's write
  availability, as now and at the end of the plan.
- **Copy as Markdown** puts the plan, its assumptions, its verdict and its steps into the change's review or ticket.
  A run has an address, `/stores/:name/what-if?plan=…`, holding the plan and the time of the cluster it started from.
  Opened later, it says the cluster has moved on and offers to run the plan again from now.

### The model

The model is a pure function in `shared`: a cluster as spec 0057 reads it, settings, rates and a plan in; steps
out. It runs in the browser, so trying a plan costs Estate and Prometheus nothing. It is deterministic, and the same
inputs give the same run.

```ts
whatIf(cluster, settings, plan): ReadonlyArray<Step>   // each step: time, caption, the cluster then, marks
verdict(steps, settings): ReadonlyArray<Finding>       // ✗ / ⚠ / ✓, with the parts it names
```

Where the cluster read lacks something the model needs, such as which brokers hold followers without the JMX
exporter, the change asks for it or the run says what it could not tell. Restarts and losses need placement, so
without it they report *depends on where followers are* instead of a guess.

### Replay

The same stepper also plays the cluster's real past. **Replay** on *The cluster* reads the exporters' series over a
range (the last hour, or around a firing or an incident) and steps through what changed. The steps show brokers
going and coming, leaders moving, the ISR shrinking and growing, and lag rising, each captioned the same way. It is
not a model, so it is marked *replay* and reads from Prometheus once, when asked.

## Why this shape

The danger in a cluster change is in how this cluster is now: which partitions are at the edge of
`min.insync.replicas`, which group is already behind, where the leaders sit. A generic simulator cannot see that. The
reader in spec 0057 already has it, so a model fed from that read answers the question for this cluster, today.
Keeping the model in `shared` as a pure function makes it testable against Kafka's documented behaviour step by step.
It also keeps the cost of trying a plan in the browser.

The alternative was to read a proposed change from Git, such as a Strimzi `KafkaTopic` or `Kafka` resource in a pull
request, and run it on its own. That is where this should end up, but it needs a way to read pull requests and turn
resources into plans. Recommended: plans made on the page first, then pull requests as a later entry, both producing
the same plan.

## Depends on

Spec 0057's cluster read, with the JMX exporter for follower placement where a change needs it. Topic settings that
no exporter publishes come from the person or the store's `settings:`. Who would feel a change uses the messaging
spans of spec 0057, where Tempo is set.

## Stack

- [ ] **`what-if-model`** — the cluster, settings and a plan into steps, in `shared`, for a broker going and coming,
      leader election, ISR against `min.insync.replicas`, and catching up at a rate.
      Done when: a test restarts three brokers one by one on a cluster with a topic at the edge of
      `min.insync.replicas` and finds the window writes are refused, and with one more in sync finds none.
- [ ] **`what-if-partitions`** — adding partitions with keys moving, scaling a group under each assignor, retention
      against each group's offset, and the load factor.
      Done when: tests find the keys that move on 6 → 8 partitions, the idle member when a group has more members than
      partitions, and the messages a group loses when retention is cut below its lag.
- [ ] **`what-if-reassign`** — adding and taking out brokers, and reassignment to a set or balanced, with a throttle.
      Done when: a test balances a cluster with one broker leading half the partitions, and the steps take as long as
      the bytes moved at the throttle.
- [ ] **`what-if-verdict`** — the ✗ / ⚠ / ✓ findings from the steps, and the services that would feel each.
      Done when: a test names the topic, partitions, window and the writing services for a refused write, and says
      the source it used.
- [ ] **`what-if-panel`** — *What if…* on *The cluster*: choosing and stacking changes, settings filled or asked,
      the verdict, the steps driving the view marked *what if*, and before and after.
      Done when: a suite runs a rolling restart, steps through it, sees the view marked *what if* with the changed
      partitions outlined, and the verdict above.
- [ ] **`what-if-share`** — the run's address, *Copy as Markdown*, and *the cluster has moved on* when opened later.
      Done when: a suite opens a run's address, copies Markdown with the plan, assumptions and verdict, and sees the
      offer to run again when the cluster read is newer.
- [ ] **`kafka-replay`** — *Replay* over a range or around a firing: the exporters' series read once and stepped
      through with captions.
      Done when: against the Prometheus stub, a broker that went and came back an hour ago replays as steps that say
      so, marked *replay*.
- [ ] **`what-if-e2e`** — Playwright runs a plan on the e2e estate's Kafka store and replays its last hour, with axe
      clean.
      Done when: `bunx playwright test` passes with the walk.

## Acceptance

```bash
bun run gate
bunx playwright test
```

On a real cluster with a topic at `min.insync.replicas` equal to its in-sync replicas, *Restart brokers one by one*
names the window that topic refuses writes and the services that write to it. Raising its replication factor in the
same plan, first, clears it.

## Open questions

1. **Where do topic settings come from?** Recommended asked on the page, with Kafka's defaults filled in and a store's
   `settings:` remembered, because kafka_exporter and the JMX exporter do not publish them. Strimzi's `KafkaTopic`
   resources hold them, and reading those through spec 0031's Kubernetes reader would fill them in where Strimzi is
   used. That can be a later entry.
2. **Plans from pull requests?** Recommended later, as its own spec: a Strimzi resource or a Terraform plan in a
   pull request turned into the same plan, its verdict posted on the request.
3. **How far should the model go on timing?** Recommended only what the inputs and the rates give: down for as long
   as asked, catching up at the follower throughput the JMX exporter reads, or a rate the person sets. Anything finer
   would be a guess dressed as a number.
4. **Should the overview show a what-if in progress?** Recommended no. A what-if is one person's question and stays
   on the page that asked it. A shared run is its address.
