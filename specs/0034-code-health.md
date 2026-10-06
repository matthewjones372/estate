# 0034 — Code health per service

## Problem

A service's page says how it runs, what changed and who owns it, but not how healthy its code is: whether its last
analysis passed its quality gate, how much of it the tests cover, and whether a dependency or its own code has an open
security alert. Those are in SonarQube and in GitHub's Dependabot and code scanning, a tab each per repository, and an
owner who is looking at a service in Estate has to go and look.

## Not doing

- **Health.** Code health does not make a service degraded or put it in "needs you now"; a failed gate is not an
  incident. It is shown beside the service, in amber when it needs a look.
- **Other tools, yet.** Codecov, Snyk, GitLab's security dashboard and SonarCloud's organisation views are later
  readers behind the same part.
- **Trends.** The latest analysis only; SonarQube and GitHub keep the history and are linked to.
- **Raising issues.** Estate reads alerts; it does not dismiss, assign or file them.

## Shape

```yaml
# estate.yaml
code:
  sonarqube: { url: https://sonar.example.com, token: ${SONAR_TOKEN} }   # a token that may browse its projects
  github: { token: ${GITHUB_SECURITY_TOKEN} }   # Dependabot and code scanning alerts: read; url for Enterprise
  every: 15m                                    # 15m unless set
```

```yaml
# catalog.yaml
services:
  - name: storefront
    repository: github:example/storefront       # GitHub's alerts, from the repository it already names
    code: { sonarqube: { project: storefront } }  # SonarQube's project key
```

```text
every 15 minutes, for the whole estate, each service:
  SonarQube   /api/qualitygates/project_status?projectKey=…   the gate: passed or failed
              /api/measures/component?component=…&metricKeys=coverage,bugs,vulnerabilities,code_smells
  GitHub      /repos/{owner}/{name}/dependabot/alerts?state=open        by severity
              /repos/{owner}/{name}/code-scanning/alerts?state=open     by security severity, else severity
              a repository with no analysis or alerts turned off (404, 403) has none, not a failure
the page, under a service's cost:   code: gate failed · 71% covered · 2 critical, 1 high alerts
  amber when the gate failed or a critical or high alert is open; each part a link to its tool
/mcp's service tool: the same, as its code
estate doctor (every environment):   code  ok   storefront gate passed, 82% covered, 1 high alert; …
```

## Why this shape

The three tools each answer one question an owner asks of a service's code, and each is read where the service
already says where its code is: its repository for GitHub, a project key for SonarQube, which is not always the
repository's name. Reading them for the whole estate on a slow schedule, as builds are, keeps their API limits
untouched by the number of pages open. Recommended: keep code health out of a service's health, since the overview's
headline is what is broken now; amber on the service is enough to be seen by its owner.

## Depends on

Nothing new; the tokens are the estate owner's.

## Stack

- [x] **`code-settings`** — `code:` in the settings and a service's `code:` in the catalog.
      Done when: the settings and catalog read with them, and the example estate names them.
- [x] **`code-readers`** — SonarQube's gate and measures, Dependabot's and code scanning's open alerts by severity,
      into the estate's `code` part every 15 minutes.
      Done when: against stub tools, a service's health has its gate, coverage, counts and alerts, a repository
      without code scanning has none, and a tool that fails keeps the others' readings.
- [x] **`code-page`** — the line on a lane and a service's page, amber when it needs a look, linking to each tool;
      the `service` MCP tool's `code`.
      Done when: the page suite shows the line and its amber, and Playwright sees it for a service in the e2e estate.
- [x] **`code-doctor`** — the doctor's `code` line.
      Done when: it names each service's gate, coverage and alerts, and a failing tool in its own words.

## Acceptance

```bash
bun run gate
CHROMIUM=/opt/pw-browsers/chromium bunx playwright test
```

## Open questions

- **A project key by default?** Recommended: none; a service names its SonarQube project, since keys are often a
  group's prefix and a repository's name, and a guessed one reads another project's gate.
- **Coverage on new code, or overall?** Recommended: overall, `coverage`; the gate already judges new code.
