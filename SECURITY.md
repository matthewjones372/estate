# Security

Estate signs people in, holds tokens for the tools it reads, and can silence alerts and change log levels in a
cluster, so a weakness in it matters.

## Reporting a vulnerability

Please report it privately, through **Report a vulnerability** on this repository's **Security** tab, rather than in
an issue or a pull request. Say what an attacker can do, and how to reproduce it. You'll get an answer within a week.

## What is supported

The latest image, `ghcr.io/matthewjones372/estate:main`. Fixes go to `main` and are published as a new image.

## How Estate is meant to be run

- With sign-in through an OIDC provider, or behind something that already authenticates people. `auth.anonymous` is
  for trying Estate out on a trusted network; as an `operator` it lets anyone who reaches the page silence alerts and
  switch debug.
- With secrets in the environment, read into `estate.yaml` as `${NAME}`, never written into the file.
- With the RBAC in [`deploy/`](deploy): read-only, except patching the debug ConfigMaps a catalog names, and
  impersonation when `kubernetes.impersonate` is on.
