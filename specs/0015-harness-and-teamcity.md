# 0015 — Harness and TeamCity

## Problem

Teams that build with TeamCity, or build and deploy with Harness, see no build stage on a service's rail, and for
Harness no deploy stage either: what Harness last deployed to each environment, and why it failed when it did.

## Not doing

- **Starting, approving or rolling back runs.** Estate shows the pipeline; Harness and TeamCity run it.
- **Harness's feature flags, cloud costs and chaos modules.**
- **Harness FirstGen.** Its API is being retired; Estate reads NextGen.

## Shape

```yaml
# estate.yaml
builds:
  teamcity: { url: https://teamcity.example, token: "${TEAMCITY_TOKEN}" }
  harness: { account: abc123, apiKey: "${HARNESS_API_KEY}" }    # url: https://app.harness.io unless set
sources:
  production:
    harness: { account: abc123, apiKey: "${HARNESS_API_KEY}" }  # deploys from Harness CD
```

```yaml
# catalog
services:
  - name: checkout
    build: { teamcity: { buildType: Shop_Checkout, branch: main } }
  - name: payments
    build: { harness: { org: default, project: shop, pipeline: payments_ci } }
    deploy: { harness: { org: default, project: shop, pipeline: payments_cd, service: payments } }
```

- **TeamCity builds**: the build type's last ten builds on the branch, through its REST API with an access token:
  number, status and state, the revision it built and that change's comment, start and finish, and its web URL.
- **Harness builds**: the CI pipeline's last ten executions: status, start and end, the commit and its message from
  the CI module's information, and the execution's page.
- **Harness deploys**: per environment, the newest CD execution of the pipeline that deployed the service there.
  When it succeeded, its artifact's tag is the version chosen. When it failed, the version is the last that
  succeeded, and the stall is Harness's failure message.

## Why this shape

Both are kinds behind ports that already exist: TeamCity and Harness CI beside GitHub, GitLab and Jenkins for
builds, and Harness CD beside Flux, Argo CD and ECS for deploys. Harness CD could instead be read from its service
instance dashboards, which say what is running; but that is what the cluster already says. What Estate lacks for a
Harness team is what Harness chose and whether it got stuck, which is the execution history. Recommended: the
executions.

## Depends on

Nothing.

## Stack

- [x] **`teamcity-builds`** — builds from a TeamCity build type and branch.
      Done when: a test against TeamCity's own JSON shows a running, a failed and a passing build.
- [x] **`harness-builds`** — builds from a Harness CI pipeline's executions.
      Done when: a test against Harness's execution summaries shows a running, a failed and a passing build.
- [x] **`harness-deploys`** — what Harness CD last deployed to each environment, and its failure as a stall.
      Done when: a failed deployment shows the last good version with Harness's message as the stall.
- [x] **`harness-e2e`** — the cloud estate's ledger built by TeamCity and deployed by Harness, against fakes; the
      README and the doctor list both.
      Done when: `bunx playwright test` passes with it.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

None. Decided: Harness CD's environment and artifact are read from `moduleInfo.cd` in the execution summaries, as
Harness's API reference gives them. Before a team relies on them, `estate doctor` against their account prints
what each service's deploys read as; a service whose deployments Estate cannot read is missing from that line.
