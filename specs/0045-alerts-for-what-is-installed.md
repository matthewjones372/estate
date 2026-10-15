# 0045: Alerts for what is installed

## Problem

Dependabot raises an alert when a package Estate installs has a published advisory. It can only do that for packages
GitHub's dependency graph knows about, and the graph reads `package.json` alone: the twenty ranges written there,
`^6.2.12` rather than the 6.2.12 installed, and none of the 432 packages they bring in. `bun.lock` holds all 452
resolved versions, and GitHub's scan does not read it.

So an advisory against a transitive package, or against a version a range happens to resolve to, raises nothing.
Estate has had no alert, which says nothing about whether it should have.

## Not doing

- **The image.** `oven/bun`'s base packages are the registry's and the image scan's, not the dependency graph's.
- **Fixing advisories.** This makes them visible; each one found is its own pull request.
- **The gate.** `gate.yml`, `tools/` and `package.json` are left as they are; this is a workflow of its own.
- **Another scanner.** No OSV or Snyk step; Dependabot is already installed and already opens the update pull
  requests.

## Shape

`.github/workflows/dependency-graph.yml`, on a push to `main` that changes `bun.lock` (or the workflow), and by hand.
It reads `bun.lock` and posts it to GitHub's dependency submission API as one manifest, `bun.lock`:

- every package with a version, as `pkg:npm/<name>@<version>`, with the packages it depends on;
- `direct` for those in `package.json`, `indirect` for the rest;
- `runtime` for `dependencies` and everything they bring in, `development` for the rest.

The script is inline Python, which the runner already has, so nothing is added to `tools/` or `package.json`.

## Why this shape

Submitting the lockfile is what `gradle/actions/dependency-submission` does for a Gradle build, and Bun has no such
action yet. The alternative is a scan in the gate that fails the build on an advisory; that is the gate's
configuration, a person's to change, and it would fail unrelated pull requests the day an advisory is published.

## Depends on

Nothing. If GitHub's scan learns to read `bun.lock`, this workflow can go.

## Stack

- [ ] **`dependency-graph`** — the workflow, and this spec.
      Done when: after the merge, the dependency graph lists `bun.lock` with 452 packages.

## Acceptance

```bash
gh api repos/matthewjones372/estate/dependency-graph/sbom -q '.sbom.packages | length'
```

Over 450, where it was 27.

## Open questions

- Should a new advisory fail the gate as well as raise an alert? Recommended: no; Dependabot's pull request is the
  fix, and the gate passing it is the check.
