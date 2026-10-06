# 0023 — Tell the team

## Problem

The person who sees an alert in Estate usually needs to tell someone: the team that owns the service, or the
channel where the incident is being handled. Today they copy the alert's name, its summary and a link into Slack by
hand. Then the notes written in Estate and the conversation in Slack drift apart. Whoever reads the channel doesn't
see that someone silenced the alert or what they found, and whoever reads Estate doesn't see the thread.

## Not doing

- **Notifying on every alert.** Alertmanager, Grafana and Datadog already route alerts to Slack and to paging.
  Estate posts when someone asks it to, so it never doubles their noise.
- **Reading Slack back.** Replies in the thread stay in Slack; the card links to the thread.
- **Microsoft Teams, for now.** Its channels take posts through the Graph API with an app registration, a bigger
  setup than Slack's bot token. It follows once someone asks, behind the same port.

## Shape

```yaml
# estate.yaml
slack: { token: "${SLACK_BOT_TOKEN}" }       # a bot with chat:write, invited to the teams' channels

# catalog.yaml: the channel is the one in the team's Slack link
teams:
  - name: payments
    links: { slack: "https://example.slack.com/archives/C0PAYMENTS" }
```

```text
On the card:  [Tell Payments on Slack]

In #payments:
  🔶 OrdersSlow is firing in production: Orders are slow to place
     Impact: Customers wait to place orders, and some give up.
     Fired before: twice this month, last 6 days ago.
     Posted by ada from Estate · https://estate.example/?env=production
     ├─ ada: Vacuuming the orders table, on it.                 (a note written in Estate)
     ├─ gil silenced it for 1 hour: provider outage              (a silence written in Estate)
     └─ ✅ Resolved after 22 min                                  (seen by Estate)
```

- **"Tell <team> on Slack"** is on the card of an alert about a service whose team has a Slack link, for anyone who
  may write notes. It posts once per firing. After that the card links to the thread instead.
- **The thread follows the firing.** Notes written in Estate, silences and their ending, and the alert resolving
  are posted as replies, each under the name of whoever did it.
- **The thread is kept beside the firing** (spec 0021's record), by its environment, alert and start, in the same
  store, so a restart keeps posting into the same thread.
- **Read-only Estate posts nothing**, and without a `slack` token the button is not there.

## Why this shape

Posting on request keeps Estate from becoming another alert router; the routing teams have already tuned stays as
it is. A thread per firing keeps the channel to one message an incident while the conversation grows under it, and
replying with Estate's own notes and silences means the channel sees what Estate sees without anyone copying it.
The alternative, posting every firing automatically, would duplicate what Alertmanager already sends. Recommended:
on request, then the thread follows.

## Depends on

Spec 0021's firings, to keep the thread by. Spec 0022's teams, for the channel.

## Stack

- [x] **`slack-post`** — the button, the first message, the thread kept with the firing and linked from the card.
      Done when: a test against Slack's `chat.postMessage` answers shows the message in the team's channel, and the
      card linking to it.
- [ ] **`slack-thread`** — notes, silences and the resolution posted as replies in the thread.
      Done when: a note written in Estate on a told alert is posted as a reply under the writer's name.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **Who may tell the team?** Recommended: anyone who may write notes. Telling the team is a note to a wider audience.
- **Post every firing of chosen alerts automatically?** Recommended: not yet. If wanted, it would be an alert's
  `announce: true` in the catalog, for alerts no other tool routes.
- **Microsoft Teams?** Recommended: after Slack, when someone uses it.
