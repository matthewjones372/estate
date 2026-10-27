# 0072 — Logs from CloudWatch

## Problem

An estate on ECS sees its services' tasks, deployments, alarms and load in Estate (spec 0002), and then an empty
Logs panel. ECS services write to CloudWatch Logs through the `awslogs` driver, and Estate reads logs only from Loki,
Datadog, Elasticsearch or a Kubernetes cluster's pods. During a deploy the operator watching the page leaves it for
the CloudWatch console, signs in again, finds the log group and the task's stream, and reads raw lines there, while the
Errors view, "Lines from then" on an alert's card and the 24-hour error count (spec 0054) say nothing.

Running Loki beside CloudWatch to fill the panel would mean shipping every line twice, a store to run, and lines
leaving the region they were written in. CloudWatch already holds them.

## Not doing

- **Live Tail.** `StartLiveTail` answers as an HTTP/2 event stream (`application/vnd.amazon.eventstream`), not a
  JSON body, so it cannot go through `Remote`, be answered by the same stubs, or share the one HTTP client
  (spec 0007). It is also billed by the minute and capped at 15 sessions an account. Polling `FilterLogEvents` gives
  the same panel at up to two seconds' delay, as Loki's does.
- **Other AWS log sources.** Lambda, API Gateway, RDS and VPC flow logs live in CloudWatch too; a service that names
  its log group in the catalog gets them, but nothing discovers them.
- **Cross-account.** One environment, one account and region, through the credentials `aws:` already finds. A
  monitoring account reading linked accounts' groups by ARN is a later convenience.
- **Insights as a query language on the page.** The catalog may give the stream prefix and the error pattern; it does
  not take a Logs Insights query. Grouping and masking stay Estate's, as for every other source.
- **FireLens and other drivers.** A task that logs through `awsfirelens` or `splunk` is not read from its task
  definition; it names its group in the catalog, or `estate doctor` says it has none.
- **Infrequent Access groups for Live.** That log class does not answer `FilterLogEvents`. Its services get Errors
  (Insights reads it) and an empty Live view saying why.
- **New AWS credentials or signing.** The SigV4 caller from spec 0002 (`makeAwsJson`) is used as it is.

## Shape

**Sources**, per environment in `estate.yaml`, beside the `aws:` that already reads ECS and CloudWatch alarms:

```yaml
sources:
  production:
    aws: { region: eu-west-2 }          # ECS, CloudWatch alarms and metrics, and now its logs
    cloudwatchLogs: {}                  # services' lines from CloudWatch Logs, in place of loki/elasticsearch/datadog
    # cloudwatchLogs: { callsPerSecond: 4, errorsEvery: 5m }   # the defaults
```

`cloudwatchLogs` without `aws` is a mistake named at start. It takes the region and endpoint from `aws`, so
LocalStack answers it in tests as it answers CloudWatch's alarms. In `logsFor`'s order it comes after Loki, Datadog
and Elasticsearch and before the cluster's pods.

**The catalog** needs nothing for an ECS service that logs with `awslogs`: its group and stream prefix come from its
task definition. A service that logs elsewhere, or runs more than one container, says so:

```yaml
services:
  - name: orders
    runtime: { ecs: { cluster: shop, service: orders } }
    logs:
      cloudwatch:
        group: /shop/production/orders        # the default is the task definition's awslogs-group
        prefix: orders/app/                   # a stream prefix; the default is <awslogs-stream-prefix>/<container>/
        container: app                        # which container's streams, when the task has several
      errors: 'ERROR|FATAL'                   # as today
      mask: [ 'Bearer [A-Za-z0-9._-]+' ]      # as today, applied on the server
```

The defaults, read once per task definition revision with `ecs:DescribeTaskDefinition` (which the ECS reader already
calls for the image) and kept with its images:

- **group**: the `awslogs-group` option of the container's `logConfiguration`.
- **prefix**: `<awslogs-stream-prefix>/<container name>/`, as `awslogs` names each stream
  `prefix/container/task-id`. Without a stream prefix, no prefix: the whole group.
- **container**: the one container with `logDriver: awslogs`; with several, the essential one named as the service,
  else the first, and `estate doctor` says which it chose.
- **the "pod" of a line**: the task id, the stream name's last segment, so it matches the task names on the ECS
  view. A stream that is not `awslogs`-shaped shows its whole name.
- **level**: from a JSON line's `level`, `severity` or `log.level` field, else the text, as `lineOf` does now.

A service with neither `runtime.ecs` nor `logs.cloudwatch.group` has no logs in that environment, and its panel says
so, as a service with no Loki selector does today.

**Live**, through the same log hub (one reader per service, every two seconds, newest 200 a read):

```ts
// src/server/sources/cloudwatch-logs.ts
export const cloudwatchLogsApi = { service: "logs", target: "Logs_20140328", version: "1.1", name: "CloudWatch Logs" } as const

export const cloudwatchLines = (
  logs: AwsJson,
  where: LogGroupOf,            // { group, prefix } for the service
  from: number,
  to: number,
  limit: number,
): Effect.Effect<ReadonlyArray<Line>, Failure>
```

- `FilterLogEvents` with `logGroupIdentifier`, `logStreamNamePrefix`, `startTime`, `endTime` and `limit`, following
  `nextToken` (a page can be empty and still carry one). CloudWatch answers oldest first, so to keep the newest
  `limit` a read follows at most five pages; if more remain it reads again from a minute before `to` and says the
  older lines were skipped, as the 200-line cap does now.
- **Late lines.** CloudWatch can make a line searchable seconds after its timestamp. Reading strictly from the last
  line seen would lose those, so `ServiceLogs` gains an optional `overlap` (10 seconds for CloudWatch, none for the
  rest): the hub reads from `last - overlap`, and drops lines it already sent by
  their time, task and text, remembered for the overlap. (Lines carry no id to the page, so none is kept.)
- **The account's budget.** `FilterLogEvents` is held to 10 calls a second per account in eu-west-2, 5 in some
  regions, not adjustable, and shared with the console and everything else in the account. All CloudWatch readers in
  an Estate process share one budget, `CloudwatchBudget`, at `callsPerSecond` (default 4). When more services are watched than
  four calls a second covers at two seconds each, every reader's interval stretches evenly, and the panel shows
  "every 4 s" in place of "live". A `ThrottlingException` backs off the shared limiter and is shown as the source
  being slow, never as the panel failing.
- An Infrequent Access group answers `FilterLogEvents` with an error; the Live view says "this log group's class
  has no live lines" and Errors still works.

**Errors**, `GET /api/logs/errors` and spec 0054's 24-hour count, through Logs Insights:

```
fields @timestamp, @message, @logStream
| filter @logStream like /^orders\/app\//
| filter @message like /(?i)error|fatal|panic|exception/
| sort @timestamp desc
| limit 2000
```

- `StartQuery` (`logGroupIdentifiers: [group]`, times in seconds), then `GetQueryResults` once a second until
  `Complete`, `Failed`, `Cancelled` or `Timeout`. After 30 seconds Estate calls `StopQuery` and reports the source as
  slow. A watcher leaving does not stop a query another page is waiting on.
- The message filter is the catalog's `errors` pattern (or the default), so Insights returns a superset and
  `isError` decides, as Loki's sieve does. `capped` when 2,000 came back.
- Insights is billed by the data it scans. The log hub already reads a service's errors once a minute however many
  pages ask (spec 0054); for CloudWatch that cache lives for `errorsEvery` (default 5 minutes), and the button and the
  Errors view say how old the answer is. A day's read of a group writing 1 GB a day, every 5 minutes, scans about
  288 GB a day; the docs page on this source says so with the formula.
- Masking is applied to every line on the server before it reaches a page, as for every source.

**`estate doctor`**, per service in an environment with `cloudwatchLogs`:

```
logs  orders   CloudWatch Logs: /shop/production/orders, streams orders/app/, 412 lines in 15 min
logs  billing  CloudWatch Logs: billing's task definition logs through awsfirelens; set logs.cloudwatch.group
logs  search   CloudWatch Logs: /shop/production/search is Infrequent Access: errors only, no live lines
logs  legacy   CloudWatch Logs: AccessDeniedException on logs:FilterLogEvents for /shop/production/legacy
```

It calls `DescribeLogGroups` (by `logGroupNamePrefix`) to say a group is missing, its class and its retention, and
reads the last 15 minutes as it does for every source.

**What Estate's role needs**, in the docs beside ECS's and CloudWatch's, scoped to the estate's groups where it can be:

```json
{
  "Effect": "Allow",
  "Action": [
    "logs:FilterLogEvents",
    "logs:StartQuery",
    "logs:GetQueryResults",
    "logs:StopQuery",
    "logs:DescribeLogGroups"
  ],
  "Resource": "*"
}
```

`logs:GetQueryResults` and `logs:StopQuery` act on a query id, not a group, and `logs:DescribeLogGroups` lists by
prefix, so a policy scoped to `arn:aws:logs:<region>:<account>:log-group:/shop/*` covers `FilterLogEvents` and
`StartQuery` and needs `*` for the rest. `ecs:DescribeTaskDefinition` is already required by the ECS reader.

## Why this shape

Reading CloudWatch where the lines already are needs nothing shipped, nothing to run, and keeps the lines in the
region they were written in; the cost is per query, which the shared rate limiter and the errors cache keep small.
The alternative was a `cloudwatch: { region, logGroups }` section listing every group per environment. The region is
already `aws.region`, and the group is the task definition's, which differs per environment while the catalog is
shared across them (spec 0035), so a list in settings would repeat what ECS already knows and drift from it.
Recommended: groups from the task definition, named in the catalog only when they cannot be found. Live through
`FilterLogEvents` polling, not Live Tail, keeps the one HTTP client and its stubs; Errors through Insights, not
`FilterLogEvents` with a filter pattern, because filter patterns' regular expressions are narrower than the
catalog's `errors` patterns, and Insights can sort newest first, which is what a capped read needs.

## Depends on

- **Spec 0002's `aws:` source and `makeAwsJson`**: done. CloudWatch Logs is a JSON 1.1 API (`Logs_20140328`), the
  shape `makeAwsJson` already signs.
- **Spec 0054's errors count**: done. This spec changes only how long the CloudWatch answer is cached.
- **The estate's read-only role** granting the five `logs:` actions above. Until it does, `estate doctor` names the
  refused action and the panel says the source refused, as for any source.

## Stack

- [x] **`cloudwatch-logs-live`** — `cloudwatchLogs` in settings, `logs.cloudwatch` in the catalog, the group and
      prefix from the task definition, `FilterLogEvents` with paging, the overlap and the shared rate limiter, and
      `logsFor` choosing it.
      Done when: against a stub of `FilterLogEvents`, an ECS service's lines arrive masked and in order with their
      task id, a line written late inside the overlap arrives once, and six watched services at `callsPerSecond: 2`
      never make more than two calls a second.
- [ ] **`cloudwatch-logs-errors`** — Logs Insights for the Errors view and the 24-hour count: `StartQuery`,
      `GetQueryResults`, `StopQuery` after 30 seconds, and the `errorsEvery` cache.
      Done when: against a stub that answers `Running` twice then `Complete`, errors group by message; a stub that
      never completes is stopped and reported slow; two pages asking within five minutes start one query.
- [ ] **`cloudwatch-logs-doctor`** — `estate doctor`'s findings with `DescribeLogGroups`, the IAM policy in the docs,
      `e2e/cloud-tools.ts` answering as CloudWatch Logs, CloudWatch Logs in LocalStack in `bun run integration`, and
      the panel's "every 4 s", "slow" and Infrequent Access wording.
      Done when: Playwright watches a line arrive on the ECS environment's checkout page and opens an error group,
      and `integration/cloudwatch.it.ts` reads lines and errors back from LocalStack.

## Acceptance

```bash
bun run gate
bunx playwright test e2e/cloud.pw.ts   # e2e/cloud-tools.ts answers as ECS, CloudWatch and CloudWatch Logs
bun run integration                    # CloudWatch Logs in LocalStack
estate doctor                          # against a real ECS environment: each service's group, stream prefix and lines
```

## Open questions

1. **`cloudwatchLogs: {}` or on whenever `aws:` is set?** Recommended its own key: reading logs is billed and needs
   new permissions, so an estate that has ECS and alarms today should not start querying on upgrade.
2. **`callsPerSecond` per process or per cluster (spec 0026)?** Recommended per process for now, with the default at
   4 of the 10 the account allows, so two replicas still leave room for the console. A cluster-wide limiter through
   the runner that owns the environment is a follow-up if anyone runs more.
3. **How long to cache errors?** Recommended 5 minutes for CloudWatch, against a minute for the others, because each
   read is billed by what it scans; `errorsEvery` lets an estate with small groups ask more often.
4. **"Lines from then" on an alert's card**: from Insights (billed, but newest first and one call) or
   `FilterLogEvents` (paged, and not an Insights scan)? Recommended `FilterLogEvents`, as it is the same short
   window the Live view reads.
5. **Insights' `(?i)` in `like`**: the docs describe Insights regexes as RE2-like; whether `(?i)` is accepted inside
   `like /…/` is to be confirmed against LocalStack and a real account in the first pull request. If it is not, the
   pattern is lower-cased and matched against `tolower(@message)`.
