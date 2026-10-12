# 0041 — Runbooks on GitHub

## Problem

A runbook link is most often a file in a repository on GitHub, such as
`https://github.com/matthewjones372/petshop/blob/main/demo/README.md`. That link is GitHub's page about the file, not
the file. Estate reads it as HTML and takes the markup out, so *Around this alert* shows GitHub's page chrome ("Skip to
content", "Navigation Menu", "Sign in", "Appearance settings", "Platform", ...) and not the runbook. Ask AI's brief
carries the same text, which costs tokens and tells the model nothing about the alert. The person on call opens the
link by hand to find out what to do.

## Not doing

- **Changing the link.** The card and the page still link to the GitHub page a person reads; only what Estate reads
  changes.
- **GitHub Enterprise Server.** Its hosts are any name and its API lives under `/api/v3`. A `blob` link on another
  host reads as it does today. It follows once someone asks.
- **Other forges.** GitLab, Bitbucket, Confluence and Notion pages read as they do today.
- **Branches with `/` in their name.** The first segment after `blob/` is taken as the ref, as GitHub's own raw links
  do; a ref like `release/1.2` reads as not found and the brief keeps the link.
- **Rendering Markdown.** It comes through as Markdown text, as a runbook in Markdown does today.

## Shape

`readRunbook` reads a `https://github.com/<owner>/<repo>/blob/<ref>/<path>` link as the file itself, ignoring any
query or fragment:

```text
runbooks: has a token for github.com
  GET https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<ref>
      accept: application/vnd.github.raw
      authorization: Bearer <token>             (Basic with user, as today)
otherwise
  GET https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
      no credentials
```

Either answer is read as text whatever its `content-type` (GitHub answers `text/plain` from raw and
`application/vnd.github.raw` from the API), cut at 4,000 characters as now. A failure says which host answered, as
now: `api.github.com answered 404`. Every other link reads as it does today.

## Why this shape

raw.githubusercontent.com needs no token and serves the file as plain text, so a public runbook works with nothing
configured. A private repository answers 404 there, so with a token the contents API reads it instead; the token is
the one `runbooks:` already gives for `github.com`, sent to GitHub's API host and nowhere else. The alternative,
taking the README's text out of GitHub's rendered page, depends on GitHub's markup and still needs a signed-in
session for private repositories.

## Depends on

Nothing.

## Stack

- [x] **`spec-0041-github-raw`**: a GitHub `blob` link read as its raw file, through the contents API with the
      `runbooks:` token for `github.com` when there is one, and raw.githubusercontent.com otherwise; README's
      `runbooks:` example names `github.com`.
      Done when: against a stubbed Remote, a `blob` link with no token calls raw.githubusercontent.com with no
      `authorization`, with a token calls the contents API with it, both come back as the file's text, and another
      host's link calls the link itself; `bun run gate` passes.

## Acceptance

```bash
bun run gate
```

With the petshop demo, an alert's *Around this alert* shows `demo/README.md`'s text under Runbook.

## Open questions

- **Is sending `github.com`'s token to `api.github.com` "that host"?** Spec 0024 says the credentials go to the
  link's host alone. Recommended: yes for this one pair, since both are GitHub's and the token is a GitHub token; an
  entry for `api.github.com` is not needed and is not read.
- **Raw first even with a token?** Recommended: no; with a token, the API alone, so a private file never makes an
  unauthenticated request that only tells GitHub what was asked for.
