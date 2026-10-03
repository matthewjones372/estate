# 0022 — Who to ask

## Problem

A service in the catalog has an `owner`, a team's name, and nothing more. The person looking at a failing service
or a firing alert next wants to reach that team: its Slack or Teams channel, its pages in Confluence or Notion, who
is on call. Today they leave Estate to find out, and the answer is usually in someone's head.

## Not doing

- **Who is on call now.** Estate links to the team's on-call schedule. Reading PagerDuty's or Opsgenie's rota is a
  spec of its own.
- **Posting to Slack or Teams.** Estate links to the channel; it sends nothing.
- **People.** Teams are names and links. Estate keeps no directory of who is in them.

## Shape

```yaml
# catalog.yaml
teams:
  - name: payments                     # what a service's, job's or agent's `owner` names
    title: Payments
    links:
      slack: https://example.slack.com/archives/C0PAYMENTS
      teams: https://teams.microsoft.com/l/channel/…
      confluence: https://example.atlassian.net/wiki/spaces/PAY
      notion: https://www.notion.so/example/Payments-…
      oncall: https://example.pagerduty.com/schedules/P123
services:
  - name: payments
    owner: payments
```

- **A service's page** says who owns it, by the team's title, with the team's links beside it.
- **An alert's card** about a service carries its team's chat link, such as "Payments on Slack", next to the
  runbook, so the person who sees it can ask the owners straight away.
- **A job's lane and an agent's** show their owner's links as a service's page does.
- **A screen** narrowed with `?team=payments` is titled with the team's title.
- **Links** take `{team}` and `{env}` as other links take their names. Any link name is allowed. Slack, Teams,
  Confluence, Notion and on-call have their own icon and label.
- **`estate check`**, once `teams:` is set, names an owner that is not one of them.

## Why this shape

Teams are listed once and named by owner, so a team's channel is written in one place, not on each of its twenty
services. An owner without a `teams:` entry keeps working as a plain name, so no catalog breaks. The alternative,
links on each service, is what teams do today with `links:`, and it drifts as soon as a channel is renamed.
Recommended: teams listed once.

## Depends on

Nothing.

## Stack

- [x] **`teams`** — the catalog's teams, checked; their links on service pages, alert cards and job lanes; the
      screen's title.
      Done when: the example estate's OrdersSlow alert carries "Orders on Slack", and its service page the team's
      links.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

None. Decided: any link name is allowed, and five have icons. A chat link (`slack` or `teams`) is the one put on
alert cards.
