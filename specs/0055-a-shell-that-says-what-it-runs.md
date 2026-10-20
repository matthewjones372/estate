# 0055 — A shell that says what it runs

## Problem

`GET /*` serves the pages' shell with only `cache-control: no-cache`. It sends no Content-Security-Policy, so if a
bug ever let text from a source (an alert's description, a log line, a runbook) reach the page as markup, the
browser would run any script in it. Nothing says the page may not be framed, so another site can load Estate in a
frame and lay its own page over it. There is no `X-Content-Type-Options` or `Referrer-Policy`, so a browser may guess
a response's type, and every link out to a tool sends Estate's address with the path a person was on.

The shell also loads its two fonts from Google: a stylesheet from fonts.googleapis.com that blocks the first paint,
and the files from fonts.gstatic.com. Each page view tells Google that someone opened Estate, and a strict policy
would have to name both hosts.

## Not doing

- **Nonces or hashes for scripts.** The shell has one script, Estate's own bundle, served from `/assets/`; it has no
  inline script, so `'self'` covers it.
- **A report endpoint.** Estate runs in other people's estates and has no one to send reports to; a policy that has
  been checked against every page is enforced, not reported.
- **Headers on `/events`, `/mcp` and the API.** They answer JSON or a stream, never a page.
- **Changing what the page links to.** Links out stay links out.

## Shape

```text
GET /services/checkout
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self';
  img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self';
  frame-ancestors 'self'
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
cache-control: no-cache
```

- **The fonts** are Instrument Sans and JetBrains Mono as variable, Latin-only `woff2` files in `src/web/fonts`, both
  under the SIL Open Font License, imported by `fonts.ts` and declared through the `FontFace` API with `display: swap`.
  Bun's CSS bundler inlines a `url()` font into the stylesheet as data, where an import is emitted as a file of its
  own, so the bundle serves them under `/assets/` with the rest, hashed and immutable, and the shell preloads them.
  The Google links go from `index.html`.
- **The headers** are set where the shell is served, in `routes.ts`, and nowhere else.
- **`img-src data:`** is for the favicon, which is an SVG in the shell.
- **No style attribute** is allowed: Solid compiles a constant `style={{ … }}` into its template as a `style`
  attribute, which the browser parses from markup, so the pages and parts style themselves by class. A style that
  changes with the data is set through the CSSOM, which `style-src` does not govern.

## Why this shape

The policy could start in Report-Only, as the usual advice is, but with no one to report to it would protect nothing
and say nothing. The pages are small enough to check instead: no inline script, no `eval`, no worker, and every
fetch and the stream to the same origin. Styles needed the one change: a constant style is compiled into Solid's
template as a `style` attribute, so the parts name classes instead, and a test reads the compiled templates for any
left. An e2e test that loads every page and fails on a CSP violation is the proof. Recommended: enforced.

The fonts could stay on Google with their hosts in `style-src` and `font-src`, but then the first paint still waits
on a third party and the policy names two hosts that are not Estate's. Recommended: self-hosted.

## Depends on

Nothing.

## Stack

- [x] **`self-hosted-fonts`** — the two fonts as files in the bundle, declared by `fonts.ts` and preloaded by the
      shell; no Google links.
      Done when: the shell names no host but Estate's, and the pages draw in Instrument Sans and JetBrains Mono.
- [x] **`shell-headers`** — the policy, `nosniff` and the referrer policy on the shell.
      Done when: every page loads with no CSP violation, and a framed Estate on another origin is refused.
- [x] **`styles-by-class`** — the constant inline styles of the pages and the parts as classes in their stylesheets,
      in two pull requests, and `style-src-attr` dropped from the policy.
      Done when: no part's template has a `style` attribute, and every page still loads with no CSP violation.

## Acceptance

```bash
bun run gate
bunx playwright test
curl -sI http://127.0.0.1:8181/ | grep -i -e content-security-policy -e x-content-type-options -e referrer-policy
```

## Open questions

- Some people put Estate on a wall screen through a dashboard that frames it (a Grafana text panel, a TV app). Should
  `frame-ancestors` be set in the settings? Recommended: yes, `web.frameAncestors`, a list of origins added to
  `'self'`, empty by default; the kiosk is its own page and needs no frame.
- Should the fonts be subset to Latin to keep the files small? Recommended: yes, the Latin subset Google serves, about
  30 KB a weight; Estate's own words are English and an estate's names are ASCII.
