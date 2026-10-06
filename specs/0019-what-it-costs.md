# 0019 — What it costs

## Problem

A team can see on Estate's page whether a service is healthy, but not what it costs, or that its cost doubled last
night. The bill is in AWS Cost Explorer, Kubernetes' share of it in OpenCost or Kubecost, and AI spend in each model
provider's console. Each is a different login and a different breakdown, and none lines up with the services the team
owns. An agent's spend matters most of all, because it changes the fastest: a prompt change or a retry loop can
spend a week's budget in an afternoon.

## Not doing

- **Being a FinOps tool.** No reports, no rightsizing advice, no reservations or savings plans. Estate shows each
  entry's cost beside its health, and links to the tool that has the detail.
- **Prices of its own.** Estate reads costs from the tools that bill or allocate them. The one exception is an AI
  price table, for the live estimate described below, and that estimate is always labelled as one.
- **Budgets enforced.** Estate shows a budget passed as needing someone. It stops nothing.

## Shape

```yaml
# estate.yaml: each environment's costs are read with its other tools, since each usually bills to its own account
sources:
  production:
    costs:
      aws: { region: us-east-1, tag: service }          # Cost Explorer, by the cost allocation tag naming the service
      opencost: { url: http://opencost.opencost:9003 }   # Kubernetes' share, by namespace and workload
      anthropic: { adminKey: "${ANTHROPIC_ADMIN_KEY}" }  # the provider's own cost report
      openai: { adminKey: "${OPENAI_ADMIN_KEY}" }
      currency: USD
    every: { costs: 6h }                                # billing data changes a few times a day at most; 6h unless set
prices:                                                 # per million tokens, for the live estimate between reports
  claude-sonnet-5-5: { input: 3, output: 15 }
```

```yaml
# catalog.yaml: an entry's cost is found by its name, unless it says otherwise
services:
  - name: checkout
    cost: { tag: checkout, budget: { amount: 900, per: month } }
agents:
  - name: support-triage
    cost: { anthropic: { workspace: support }, budget: { amount: 40, per: day } }
```

```text
Overview, each lane:    checkout   … $612 this month (forecast $880 of $900)
                        support-triage   … $31 today (est. $4.20 in the last hour) — over budget at this rate
Needs someone:          Cost anomaly: checkout's NAT gateway, +$140 a day since Tuesday (AWS Cost Anomaly Detection)
```

- **AWS:** Cost Explorer's `GetCostAndUsage`, grouped by the cost allocation tag that names the service, for
  yesterday and the month so far. Also `GetCostForecast` for the month's end, and Cost Anomaly Detection's anomalies,
  which need someone. Cost Explorer charges for each call, so it is read every 6 h by default, in one grouped call
  for all entries.
- **Kubernetes:** OpenCost's allocation API, by namespace and workload, for teams that share clusters and have no
  tag per service. Kubecost answers the same API.
- **AI, from the provider:** each provider's own cost report, by the workspace, project or API key that the catalog
  gives the agent. This is the bill, and it can lag by hours.
- **AI, the live estimate:** the agent's `tokens` usage query (spec 0018), split into input and output, times the
  price table. It shows spend in the last hour, between reports, and whether today will pass the budget at this
  rate. It is labelled as an estimate wherever it appears. The provider's report replaces it once it covers the hour.
- **Bedrock** spend comes through Cost Explorer like any AWS service, by the tag on its inference profile.

## Why this shape

The bill is the truth, but it arrives hours late, and an agent can spend its day's budget in that time. So there are
two figures, never mixed. The cost the billing tool reports is shown as it is. Estate's estimate from tokens is
labelled as an estimate, and only fills the time the bill has not reached. Reading the costs, rather than pricing
resources itself, keeps Estate out of the business of knowing every price. The price table for tokens is the one
place it needs to, because no provider reports cost live.

Costs sit with each environment's other tools because an environment is usually its own account, so its bill, its
anomalies and its budgets belong to its page. Tags are how AWS splits a bill by service, and a team that has not tagged can use OpenCost for what runs in
Kubernetes. The alternative, Estate pricing usage from CloudWatch, would be wrong in the ways that matter most:
discounts, data transfer and support fees. Recommended: as above.

## Depends on

- AWS: cost allocation tags activated in Billing, and an IAM role with `ce:GetCostAndUsage`, `ce:GetCostForecast`
  and `ce:GetAnomalies`. Until tags are active, the environment's total cost shows, and no entry's share.
- AI providers: an admin key with access to the cost report, and an agent's own workspace, project or key, for its
  share to be told apart.
- Spec 0018 for agents and their `tokens` usage query.

## Stack

- [x] **`aws-costs`** — Cost Explorer by tag, the month's forecast, and anomalies as needing someone.
      Done when: a test against Cost Explorer's answers shows each service's month to date and an anomaly.
- [x] **`opencost`** — Kubernetes' share by namespace and workload.
      Done when: a service with no tag shows its cost from OpenCost.
- [ ] **`ai-costs`** — Anthropic's and OpenAI's cost reports by workspace or project.
      Done when: an agent shows yesterday's spend from the provider's report.
- [ ] **`ai-estimate`** — the live estimate from tokens and the price table, labelled, and the budget at this rate.
      Done when: an agent spending fast shows that it will pass its budget today, before the provider reports it.
- [ ] **`costs-e2e`** — cost on lanes and the service page, against fakes; the doctor reads each cost source.
      Done when: `bunx playwright test` passes with them.

## Acceptance

```bash
bun run gate
bunx playwright test
```

## Open questions

- **Which clouds and providers first?** Recommended: AWS Cost Explorer and Anthropic, then OpenAI. GCP's and
  Azure's billing exports follow if asked for.
- **Are your AWS resources tagged by service?** If not, OpenCost goes first, since it needs no tags for what runs in
  Kubernetes.
- **Where should the price table come from?** Recommended: `estate.yaml`, written by the team, because prices change
  and a stale built-in table would be wrong without anyone noticing. A shared public list, such as the one LiteLLM
  keeps, could fill in models the team has not priced, with the table saying where each price came from.
- **Cost on the kiosk?** Recommended: no. Cost is for the people who own a service, not the wall.
