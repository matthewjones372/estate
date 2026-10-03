# 0013 — Jenkins

## Problem

A service's pipeline on the page starts at its build, read from GitHub Actions or GitLab CI. Teams that build with
Jenkins see no build stage: the rail starts at "chosen", so a broken build looks like nothing happening.

## Not doing

- **Starting or re-running builds.** Estate shows the pipeline; Jenkins runs it.
- **Jira and Notion.** Neither is part of a service's pipeline or health. A runbook or a board is a link in the
  catalog, as it is now. Open incidents per service from Jira may be worth a spec of their own once a team asks.
- **Blue Ocean's API.** The plain JSON API answers the same questions and is on every Jenkins.

## Shape

```yaml
# estate.yaml
builds:
  jenkins: { url: https://jenkins.example, user: estate, token: "${JENKINS_TOKEN}" }
```

```yaml
# catalog
services:
  - name: checkout
    build: { jenkins: { job: shop/checkout, branch: main } }
```

A `job` is the folder path to the job. With `branch`, the job is a multibranch pipeline and the branch's job is
read. Estate asks `/job/shop/job/checkout/job/main/api/json` for the last ten builds: number, result, whether it is
running, start time, duration, URL and the commit it built. Each becomes a build as GitHub's and GitLab's do, and the
rail shows it.

## Why this shape

Jenkins is a third kind behind the builds port, beside GitHub and GitLab, so nothing else changes. A `tree=` query
asks for just the fields Estate uses, one call a service a read, which is what the other two cost.

## Depends on

Nothing.

## Stack

- [x] **`jenkins-builds`** — builds from Jenkins jobs and multibranch jobs, with the commit each built.
      Done when: a test against Jenkins' own JSON shows a running build, a failed one and a passing one on the rail.
- [x] **`jenkins-doctor`** — `estate doctor` checks each Jenkins job the catalog names, and the README lists Jenkins.
      Done when: a job that does not exist is named in the doctor's report.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- None yet.
