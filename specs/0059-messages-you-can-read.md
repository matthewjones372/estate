# 0059 — Messages you can read

## Problem

Spec 0057 follows a message by its trace: which partition and offset it was written to, and whether each group has
read it. It cannot say what the message said. When an order is missing from a projection, the next question is the
message itself: was the customer's id in it, was the amount negative, was it written with the old schema? Today that
means `kcat` from a pod with the cluster's credentials, then a schema registry lookup by hand, because the estate's
messages are Avro or Protobuf and unreadable as bytes. Searching a topic for a key or a field means writing a consumer.

Estate already knows where the message is. With a reader of the cluster's records and the schema registry beside it,
it can show the message decoded, and search a bounded stretch of a topic for one.

## Not doing

- **Writing to Kafka.** No producing, no replaying, no moving a group's offsets, and no consumer group of Estate's own:
  reads assign partitions and commit nothing, so they never show as a group or change anyone's lag.
- **Keeping messages.** A message is read when a page asks and shown once. Estate stores no payload, indexes no topic
  and caches nothing past the answer. A search scans what it is allowed to scan, then forgets it.
- **Searching all of a topic.** A search reads a bounded window: the newest messages of each partition, up to a
  count and a time. A topic of billions is not scanned to find one key.
- **Managing schemas.** Estate reads schemas by id from the registry. It does not register, evolve or check
  compatibility.
- **Decoding without the registry's wire format.** A message whose bytes do not start with the registry's magic byte
  is shown as text when it is UTF-8, as JSON when it parses, and as hex otherwise. Schemas named by topic or by
  record outside the wire format are an open question.
- **Messages in Ask AI.** The model reads the cluster, not payloads. Sending messages to a model is its own decision,
  later, with its own masking.

## Shape

### Where the records and the schemas are

Per environment in `estate.yaml`, beside its Prometheus and Tempo, and per Kafka store by its cluster:

```yaml
sources:
  production:
    kafka:
      bus:                                   # a Kafka store's name, written or found (spec 0057)
        records: { rest: https://kafka-rest.data:8082, auth: { basic: { user: estate, password: ${KAFKA_REST_PASSWORD} } } }
        registry: { url: https://schema-registry.data:8081, auth: { bearer: ${REGISTRY_TOKEN} } }
```

`records` is a Kafka REST proxy: Confluent's REST Proxy v3 or Redpanda's HTTP Proxy, which both read a partition
from an offset without a consumer group. `registry` is Confluent's Schema Registry API, which Apicurio and Redpanda
also serve. A store with neither set has no messages to read, and its page says so. Credentials are secrets, read
from the environment as every other secret is.

### Who may read them

Messages carry what services were given, which can be personal data. They are read as logs are:

```yaml
auth:
  messages: operator          # viewer | operator | nobody; operator unless set
```

and masked per store before a message leaves Estate, as the catalog masks a service's lines:

```yaml
stores:
  - name: bus
    messages:
      topics: '^(orders|payments)$'          # only these topics' messages may be read; none unless set
      mask:
        fields: [ customer.email, card.number, '*.token' ]   # a decoded field's path, `*` for any one level
        text: [ '\b\d{16}\b' ]                                # as a service's log mask, on text and keys
```

A found store takes `messages:` from its discover rule's `store:`. Each read is kept as an event with who, when,
which store, topic, partition and offsets, or the search asked, and is listed on the store's page for operators.

### Reading one message

```text
GET /api/store-message/:store/:topic/:partition/:offset?env=
→ { offset, timestamp, key, headers, schema: { id, subject, version, type: avro | protobuf | json }, value, masked: [paths] }
```

The record is read through the proxy, its value decoded:

- **Wire format.** Byte 0 is `0`, bytes 1 to 4 the schema id; for Protobuf the message indexes follow as varints.
- **Avro.** The schema read by id, the binary decoded to JSON by its record.
- **Protobuf.** The `.proto` read by id with its references, the indexed message decoded to JSON with field names.
- **JSON Schema.** The payload parsed as JSON, the schema noted but not applied.
- The key is decoded the same way where it carries the wire format, else as text.

The decoded value is masked by the store's fields and text, and `masked` lists what was hidden so the page can say so.

### On the page

- **Following a message** (spec 0057) shows *The message* under its path: key, headers, schema subject and version,
  and the value as a folding tree, with masked fields shown as `•••` and named.
- **A partition's recent messages** each open to the same view.
- **Search** on a topic, under its card in *The cluster*:

```text
Search orders   [ key = cust-118 ▾ ]   [ newest 10,000 a partition ▾ ]   [ last 1 h ▾ ]   [ Search ]
  3 of 60,000 read · 4.1 s
  14:25:58.114  p0 @ 1,882,340  key cust-118  {"order": 81723, "total": 41.90, "customer": {"email": "•••"}}   Follow
  …
```

  A search matches the key, a header, or a decoded field's value (`customer.id = 118`, `total > 1000`), or text in
  the decoded value. It reads each partition from its newest back, up to the count and the time asked, both capped
  by the settings, and stops at the first fifty matches. It says how much it read, so "not found" is never mistaken
  for "not there".

## Why this shape

Reading through a REST proxy keeps Estate's rule that a source is an HTTP interface tested against a stub: no Kafka
protocol client in Bun, no broker certificates in Estate, and the proxy's own authorisation decides what Estate may
read. The registry is HTTP already. Decoding in Estate rather than asking the proxy to deserialise keeps one decoder
for every proxy, and keeps masking where Estate can see the fields. The cost is two libraries, an Avro decoder and a
Protobuf parser, and a proxy the estate may not run yet.

The alternative was a Kafka client inside Estate, which reads any cluster without a proxy. It needs credentials and
TLS material for every cluster, a native or pure-JS client that works under Bun, and it puts a consumer in Estate's
process. Recommended: the proxy first, a client later as a second kind of `records` if estates without a proxy ask.

## Depends on

- Spec 0057's stores, cluster read and message following.
- A Kafka REST proxy reachable from Estate for each cluster whose messages are read (Confluent REST Proxy v3, or
  Redpanda's HTTP Proxy), and the schema registry the producers use. Until they are set, a store says it has no
  messages to read, and everything in spec 0057 still works.
- Two dependencies, each a decision for the gate's owner: an Avro decoder (`avsc`) and a Protobuf parser
  (`protobufjs`). Both are pure JavaScript and run under Bun.

## Stack

- [ ] **`registry-reader`** — `registry:` in the settings, and the schema registry's reader: a schema by id with its
      type, subject, version and references, kept for the life of the process since an id never changes.
      Done when: against a stub of the registry's API, Avro, Protobuf and JSON schemas read by id, a reference is
      followed, and a failing registry is a `SourceFailure`.
- [ ] **`wire-decode`** — the registry's wire format decoded: Avro, Protobuf with message indexes, JSON Schema, and
      text, JSON or hex without it.
      Done when: fixtures written with each type decode to the JSON they were written from, and a short or unknown
      payload says why it could not be decoded.
- [ ] **`records-reader`** — `records:` in the settings, and the proxy's reader: one record by partition and offset,
      and a partition's records back from the newest, for Confluent's v3 and Redpanda's API, with no consumer group.
      Done when: against stubs of both proxies, a record reads with its key, headers and timestamp, and no call
      creates or commits a group.
- [ ] **`messages-auth-mask`** — `auth.messages`, a store's `messages.topics` and `mask`, and each read kept as an
      event.
      Done when: a viewer is refused where messages are for operators, a topic not allowed is refused, a masked field
      and a masked number come back as `•••` and are named, and the read is listed with who asked.
- [ ] **`message-endpoint`** — `GET /api/store-message/...`, decoded and masked.
      Done when: against the proxy and registry stubs, an Avro and a Protobuf message come back decoded, and a store
      without `records:` is a 404 that says so.
- [ ] **`message-view`** — *The message* on a followed message and from a partition's recent messages.
      Done when: a suite shows the key, headers, subject and version, the value as a tree, and the masked fields named.
- [ ] **`topic-search`** — search a topic by key, header, field or text, within the window asked and the settings' caps.
      Done when: against the stubs, a search finds the key in the newest records, says how many it read, stops at the
      cap, and a field comparison matches decoded values.
- [ ] **`messages-e2e`** — the e2e tools play a REST proxy and a registry with Avro and Protobuf messages; Playwright
      follows a message to its decoded value and searches a topic, with axe clean.
      Done when: `bunx playwright test` passes with the walk.

## Acceptance

```bash
bun run gate
bunx playwright test
```

Against a real cluster with a REST proxy and a registry, following an order placed in the petshop demo shows its
decoded value with the customer's email masked, and searching orders for its key finds it within the newest 10,000.

## Open questions

1. **A REST proxy, or a Kafka client in Estate?** Recommended the proxy first: it keeps Estate on HTTP sources with
   stubs, and the proxy's authorisation is the estate's. A client can come later as a second kind of `records:` if
   estates without a proxy ask.
2. **Messages for operators by default?** Recommended yes, with `nobody` available and `viewer` a deliberate choice,
   since payloads are more likely than logs to hold personal data.
3. **No topics readable until named?** Recommended yes: `messages.topics` must name the topics a store's messages may
   be read from, so turning on `records:` does not open every topic at once.
4. **Search caps?** Recommended 10,000 records a partition and one hour by default, 100,000 and 24 hours at most,
   fifty matches, and one search at a time per person. These keep a search under a few seconds against a proxy.
5. **Schemas outside the wire format?** Recommended later: a store may name a subject per topic for producers that
   do not write the magic byte. Until then those messages show as text, JSON or hex.
6. **Payloads in Ask AI?** Recommended not in this spec. Sending decoded messages to a model needs its own masking
   rules and a person's choice per ask; it can be its own entry once message reading has been used for a while.
