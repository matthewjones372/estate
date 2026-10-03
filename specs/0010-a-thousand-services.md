# 0010 — A thousand services

## Problem

Measured against tools that answer for any service, two environments, each service with three load
queries, a Deployment and a Flux image policy, the tools answering in 20 ms:

| Services | Full metrics read | Calls to the tools | Estate's memory | First data to a page | Page drawn |
|---|---|---|---|---|---|
| 50 | 2 s | 35/s | 127 MB | 0.4 MB | 0.7 s |
| 250 | 3 s | 168/s | 135 MB | 1.1 MB | 1.5 s |
| 1,000 | 7 s | 464/s | 173 MB | 4.4 MB | 1.9 s |

| 1,000 services | CPU | Memory | Sent to each page a minute |
|---|---|---|---|
| 1 page open | 42% of a core | 175 MB | 4.4 MB |
| 20 pages open | 110% | 493 MB | 12.4 MB |

Reading scales: a thousand services' metrics take 7 s of their 30. Viewing does not. Every open page builds every
view of the whole estate, and serialises it to compare with what it sent, on every change to any environment's
state, about ten times every 30 s; so twenty pages cost twenty times the work, and a single core is spent. The page
itself holds 880 MB at a thousand services, because each lane searched the whole list for its own state and so read
every service. Each time a
service's numbers move, every service is sent again, with every number at full precision (`73.48573829174563`). And
the cluster is asked about each service on its own, two calls a service every 15 s, where one list a namespace would
do.

## Not doing

- **Fewer queries to Prometheus.** Three a service every 30 s is what the page shows; a thousand services is 200 a
  second, which Prometheus serves. A team that wants fewer names fewer.
- **Paging or virtualising the lanes.** A thousand lanes draw in under two seconds; the page stays one page.
- **More than one Estate.** One container, as spec 0001 says.

## Shape

- Each environment's views are built once per change, in one stream shared by everyone watching it, and only when
  something that environment shows has changed. Its frames are kept for whoever connects next.
- The `services` event carries only the services that changed since the last, and the page merges them; a service
  whose series only moved along (the hour's window moves once a minute) is sent as the points each series gained, and
  any of its last points revised by late samples. Numbers are sent to four significant figures.
- The cluster is read a namespace at a time: its Deployments, StatefulSets, DaemonSets, pods and Flux image policies
  listed once per read, whatever number of services live there.
- The page finds each lane's state, pipeline and map flow in a map built once per change, not by searching every
  service, and holds each series whole rather than tracking it point by point.
- Paged reads (CloudWatch's alarms, DynamoDB's scans) are `Stream.paginate`, and the log hub's polling is a stream
  into its `PubSub`, so every flow of data in Estate is a `Stream`.

## Why this shape

Sharing the stream is the change that matters: it turns the cost of a viewer from "rebuild the estate" into "receive
a string". Effect's `Stream.share` with a replay, kept per environment in an `RcMap` as the log hub keeps its readers,
is that exactly, and stops when the last page leaves. Sending only changed services was weighed against compressing
the stream; compression would shrink the bytes but not the work of building them, and server-sent events need a
flush per message that Bun's compression streams do not give. Recommended: changed services only.

## Depends on

Nothing.

## Stack

- [x] **`shared-views`** — one stream of frames per environment, shared and replayed, rebuilt only when that
      environment's part of the state changes.
      Done when: at 1,000 services, twenty pages cost under 1.5 times the CPU of one.
- [x] **`changed-services`** — the `services` event as the services that changed, merged by the page; numbers to four
      significant figures.
      Done when: at 1,000 services, a page receives under 1 MB a minute once loaded.
- [x] **`namespace-lists`** — the cluster and Flux read a namespace at a time.
      Done when: at 1,000 services in one namespace, calls to the tools fall below 250 a second.
- [x] **`page-lookups`** — lanes and the map look services up by name, series are held whole by the page's store.
      Done when: at 1,000 services, a page's heap after a collection is under 150 MB.
- [x] **`streams`** — `Stream.paginate` for paged reads, the log hub's polling a stream.
      Done when: nothing in `src/server` pages or polls by hand.

The bench these numbers come from, and budgets that keep them, are spec 0011.

## Acceptance

```bash
bun run gate
```
