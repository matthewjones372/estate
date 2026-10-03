# 0017 — What a review found

## Problem

A review of the server found three faults in sign-in and four in what Estate says about itself.

- **An open redirect.** `/auth/login?returnTo=` is sealed into the sign-in attempt and followed after the callback,
  whatever it is. `/auth/login?returnTo=https://evil.example` signs a person in and sends them off Estate, to a page
  that can look like it.
- **Cookies sent over plain HTTP.** The session, attempt and kiosk cookies have no `Secure` flag, so a browser sends
  them over `http://` to the same host.
- **A key imported every request.** The HMAC key is imported on every seal and unseal: every request that has a
  cookie.
- **A silence that comes undone.** After a silence is written the alert is shown silenced at once, but the next read
  of the alerts can come before the manager's answer includes it, and shows the alert firing again until the read
  after.
- **An unsilenced alert always firing.** Ending a silence shows the alert firing, even when it was pending.
- **Ready before it knows anything.** `/healthz` answers `ok` from the first moment, and Kubernetes uses it for
  readiness too, so a new pod takes traffic before it has read a single source, and shows empty pages.
- **A shell with no sign-in.** `GET /*` serves `index.html` to anyone. That is right only while it is a shell.

## Not doing

- **Reworking the source fibers, the catalog check or the routes.** The review found them the right shape.
- **Keeping a silence until it ends.** The manager is the record; Estate shows its own write only until the manager
  has it.

## Shape

```text
GET /auth/login?returnTo=https://evil.example   → signed in, then sent to /
GET /auth/login?returnTo=/services/checkout     → signed in, then sent there
Set-Cookie: estate_session=…; HttpOnly; SameSite=Lax; Secure     when auth.oidc.publicUrl is https
GET /healthz   200 ok                            the process answers: liveness
GET /readyz    503 waiting for production metrics, …   until every configured part has been read once
GET /readyz    200 ready                         read once, whether it answered or failed
```

- **`returnTo`** is kept only when it is a path on this host: it starts with `/`, and not `//` or `/\`. Anything
  else is `/`. It is checked when the attempt is sealed and again when it is followed.
- **`Secure`** is set on every cookie Estate sets when `auth.oidc.publicUrl` is `https://`. Without OIDC (anonymous,
  for trying Estate out, often on `http://localhost`) it is not.
- **The key** is imported once a secret, and kept.
- **A silence written or ended through Estate is held** for the alert until the manager's answer agrees, or for two
  minutes, whichever is sooner. While held, each read of the alerts shows the alert as Estate wrote it.
- **Ending a silence** shows the alert in the state it had before the silence: the state held from Estate's own
  silence when there is one, and otherwise firing, since Alertmanager and Datadog only hold firing alerts.
- **`/readyz`** answers 503 naming what it is waiting for until every part an environment is configured to read, and
  builds, has been read once. A source that fails its first read counts as read: a tool that is down makes Estate
  say so on the page, not drop out of the load balancer. The deployment's readiness probe uses it.
- **The shell** is tested to be exactly the built `index.html`, with a comment where it is served saying nothing
  from the estate goes in it.

## Why this shape

Readiness could wait for each source to answer, as the review suggested. But then one tool that is down keeps every
new pod out of service, and a rolling update with a tool down never finishes; Estate exists to show which tool is
down. Read once, answered or failed, is what makes the first page right. The hold could instead last until the
silence ends, but then a silence removed in Alertmanager's own page would still show silenced in Estate for hours.
Recommended: both as above.

## Depends on

Nothing.

## Stack

- [x] **`sign-in-redirect`** — `returnTo` kept only when it is a path on this host.
      Done when: a sign-in started with `returnTo=https://evil.example` ends at `/`.
- [x] **`secure-cookies`** — `Secure` on every cookie when the public URL is https; the key imported once.
      Done when: the session, attempt and kiosk cookies are `Secure` behind https, and not on `http://localhost`.
- [x] **`held-silences`** — Estate's own silences held until the manager agrees; ending one restores the state.
      Done when: a read that does not have the new silence yet still shows the alert silenced, and a pending alert
      silenced and unsilenced is pending.
- [x] **`readyz`** — readiness after every configured part has been read once; the shell tested.
      Done when: `/readyz` is 503 until the first reads, then 200 even when one failed.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

None. Decided: readiness waits for a first read, not a first answer; a held write lasts at most two minutes.
