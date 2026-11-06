# 0073 — GCP Cloud Run and Monitoring

## Problem

An estate deployed on Google Cloud Platform (GCP) sees its services running on Cloud Run, its metrics and alert
policies in Cloud Monitoring (with Google Cloud Managed Service for Prometheus), and its log entries in Cloud
Logging. Today, Estate reads workloads from Kubernetes and ECS, alerts from Alertmanager, Grafana, Datadog and
CloudWatch, metrics from Prometheus, CloudWatch and Datadog, and logs from Loki, Elasticsearch, Datadog and
CloudWatch Logs.

Without GCP sources, teams hosting containerised microservices and batch jobs on Cloud Run cannot use Estate without
deploying redundant monitoring intermediaries (such as self-hosted Prometheus or Loki instances). GCP already holds
the service revisions, execution records, alerts, metrics and logs natively.

## Not doing

- **GKE workload discovery or Kubernetes impersonation.** GKE clusters expose standard Kubernetes APIs and are already
  served by Estate's `kubernetes:` runtime port (spec 0002 / 0031).
- **Mutating Cloud Run services or jobs.** Estate does not trigger deploys, scale services, or write environment
  variables. Silencing alerts on Cloud Monitoring is read-only (as with CloudWatch).
- **Google Cloud Trace waterfalls.** Trace IDs on log entries are extracted and preserved on line panels (spec 0048);
  direct trace visualization remains scoped to Tempo and Jaeger (spec 0046).
- **Full Cloud Logging streaming via gRPC / Pub/Sub.** Cloud Logging entries are read via HTTP JSON `entries:list`
  through `Remote` with standard polling and overlap deduplication, identical to Loki and CloudWatch Logs.

## Shape

**Sources**, per environment in `estate.yaml`:

```yaml
sources:
  production:
    gcp:
      project: my-gcp-project
      region: europe-west2             # default location for Cloud Run and regional services
      # endpoint: http://localhost:8080 # optional stub endpoint for testing
    cloudLogging: {}                   # live lines and error groups from Cloud Logging
    # cloudLogging: { callsPerSecond: 4, errorsEvery: 5m }
```

`cloudLogging` without `gcp` is a configuration mistake reported at startup, matching `cloudwatchLogs` without `aws`.
When `gcp:` is present in an environment's sources:
- `runtimeOf(section)` resolves `"cloud-run"`.
- `deploysOf(section)` resolves `"cloud-run"`.
- `alertsOf(section)` includes `"cloud-monitoring"`.
- `metricsOf(section)` resolves `"cloud-monitoring"` (using Google Cloud Managed Service for Prometheus).

**The catalog** connects services and jobs to Cloud Run and Cloud Logging:

```yaml
services:
  - name: orders
    runtime:
      cloudRun:
        service: orders-api            # Cloud Run service name (defaults to catalog service name if omitted)
        region: europe-west2           # optional; defaults to gcp.region
    jobs:
      - kind: CloudRunJob
        name: orders-nightly-sync
    logs:
      cloudLogging:
        service: orders-api            # optional; defaults to runtime.cloudRun service name
        container: orders              # optional container name filter
    load:
      requests: 'sum(rate(run_googleapis_com:request_count{service_name="orders-api"}[1m]))'
```

Standalone jobs (spec 0018) can also run on Cloud Run:

```yaml
jobs:
  - name: daily-reconciliation
    environments: [production]
    run:
      cloudRun:
        job: recon-job
        region: europe-west2
```

**Credentials and Authenticated Calls**:
GCP API calls require an OAuth2 Bearer token in the `Authorization: Bearer <token>` header. The token resolver
in `src/server/gcp/credentials.ts` inspects standard GCP authentication sources in priority order:
1. Direct bearer token via `GCP_ACCESS_TOKEN` environment variable.
2. Google Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` file or `~/.config/gcloud/application_default_credentials.json`):
   - Service account keys: signs an RS256 JWT assertion via `jose` and exchanges it for an OAuth2 token at `https://oauth2.googleapis.com/token`.
   - Authorized user credentials: uses `refresh_token`, `client_id`, and `client_secret` to obtain an access token.
3. Compute / Cloud Run Metadata Server at `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token` with header `Metadata-Flavor: Google`.
Tokens are cached in a `Ref` until 5 minutes before their expiration time (`expires_in`).

**Cloud Run Runtime, Deploys, and Jobs**:
- Service workloads and deploys are queried via the Cloud Run Admin API v2 (`run.googleapis.com/v2`):
  - `GET /v2/projects/${project}/locations/${region}/services/${service}`
  - `GET /v2/projects/${project}/locations/${region}/services/${service}/revisions`
  - Active revisions are represented as `Pod`s (revision name, condition states, container image, creation time).
  - Deployments reflect `latestReadyRevision` vs `latestCreatedRevision` as `Chosen` (image tag/revision, `ready` boolean, update timestamp, and condition error reason when stalled).
- Cloud Run Job executions are queried via:
  - `GET /v2/projects/${project}/locations/${region}/jobs/${job}/executions`
  - Mapped to `Job` runs (execution name, completion state `succeeded`/`failed`, start and end times, error message).

**Cloud Monitoring Alerts and Metrics**:
- Alerts: queried via Cloud Monitoring v3 (`monitoring.googleapis.com/v3`):
  - `GET /v3/projects/${project}/alertPolicies` and open incidents/alerts.
  - Active incidents map to `SourcedAlert`s with `firing` state, display name, condition documentation, and labels.
- Metrics: Google Cloud Managed Service for Prometheus provides a standard Prometheus HTTP API endpoint at:
  `${endpoint}/v1/projects/${project}/location/global/prometheus/api/v1/query_range`
  Estate reuses its Prometheus range evaluation logic, authenticated with the GCP Bearer token, giving full PromQL,
  JVM preset vitals, and threshold evaluation without custom query transformations.

**Cloud Logging**:
- Live lines and errors are retrieved via:
  - `POST ${endpoint}/v2/entries:list`
  - Resource: `projects/${project}`
  - Filter: `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}"`
  - Line ordering: newest first with pagination and a 10-second overlap buffer.
  - Pod attribution: extracted from `labels["run.googleapis.com/execution_name"]` or `resource.labels.revision_name`.

## Why this shape

By aligning with GCP's standard OAuth2 token flow and Managed Service for Prometheus endpoint, Estate avoids
heavy vendor SDKs and preserves its uniform model: workloads become `Pod`s, executions become `Job`s, and PromQL
queries work identically across Kubernetes, Prometheus, and GCP.

## Depends on

- Spec 0002 (`ports` and `runtimeOf`, `deploysOf`, `alertsOf`, `metricsOf`).
- Spec 0018 (Standalone jobs and `runsAs`).
- Spec 0072 (Log lines, overlap window, and rate budgets).

## Stack

- [x] **`gcp-credentials`** — OAuth2 Bearer token resolution (environment token, service account JWT via `jose`, authorized user refresh, metadata server) with 5-minute expiry caching.
- [x] **`cloud-run-runtime`** — Cloud Run v2 services, revisions as `Pod`s, deploy status as `Chosen`, and Cloud Run Job executions as `Job` runs.
- [x] **`cloud-monitoring`** — Cloud Monitoring open incidents as alerts, and Managed Service for Prometheus range queries.
- [x] **`cloud-logging`** — Live lines and errors via Cloud Logging `entries:list` with rate limiting and overlap.
- [x] **`wiring-and-gate`** — Integration into `catalog.ts`, `settings.ts`, `ports.ts`, `ranges.ts`, `alerts.ts`, `logs.ts`, `standalone.ts`, and full verification under `bun run gate`.

## Acceptance

```bash
bun run gate
```
