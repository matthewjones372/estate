/**
 * The demo's model behind the OpenAI-compatible API: no model at all. It answers Ask AI with a canned answer that
 * fits what the brief is about, and each answer says first that it is canned.
 */
const canned = "Demo answer, canned: no model was asked."

interface Answer {
  readonly likelyCause: string
  readonly evidence: ReadonlyArray<{ readonly text: string }>
  readonly nextSteps: ReadonlyArray<string>
  readonly confidence: "low" | "medium" | "high"
}

const answers: ReadonlyArray<readonly [RegExp, Answer]> = [
  [
    /CheckoutSlow/,
    {
      likelyCause: `${canned} Checkout's latest version holds a database connection while it reserves a slot, so its pool runs dry under load and p99 climbs.`,
      evidence: [
        {
          text: "p99 rose from about 80 ms to over 900 ms in the five minutes after checkout's new version rolled out",
        },
        { text: "checkout's pods log 'pool exhausted, waited for a connection' on slot reservations" },
        {
          text: "orders-db's connections are up, but its commits a second are not: the time is spent waiting, not working",
        },
      ],
      nextSteps: [
        "Roll checkout back to its previous version while the slot reservation is fixed",
        "Raise checkout's pool size only if the rollback is not possible",
      ],
      confidence: "medium",
    },
  ],
  [
    /ConsumerLagGrowing/,
    {
      likelyCause: `${canned} Broker 4 left bus, and picking's consumer of orders partition 7 kept fetching from it until the leader moved; it is now 26,000 messages behind on that partition alone.`,
      evidence: [
        { text: "picking's lag grows by about 24 messages a second across orders' 12 partitions" },
        { text: "orders p7 is far behind the rest, which are a couple of thousand each" },
        { text: "picking's pods log 'fetch from broker 4 failed: connection refused' and have restarted" },
      ],
      nextSteps: [
        "Bring broker 4 back, or reassign its partitions so every replica set is whole",
        "Scale picking from 3 to 6 members until the lag drains",
      ],
      confidence: "high",
    },
  ],
  [
    /broker|Kafka|kafka|partition/,
    {
      likelyCause: `${canned} Broker 4 of bus has been gone for about ten minutes. The partitions it led moved to other brokers, so nothing is offline, but every partition it held a replica of is short of one.`,
      evidence: [
        { text: "kafka_exporter has not seen broker 4 since it left; five of six brokers report" },
        { text: "partitions whose replicas include broker 4 have two of three in sync" },
        { text: "picking, the group reading orders, is the one falling behind" },
      ],
      nextSteps: [
        "Find out why broker 4 stopped: its node, its disk, or its pod's events",
        "Until it is back, avoid restarting another broker: some partitions would lose their last in-sync follower",
      ],
      confidence: "high",
    },
  ],
]

const fallback: Answer = {
  likelyCause: `${canned} Nothing in what Estate sent explains this on its own.`,
  evidence: [{ text: "no change, deploy or error near it in the brief" }],
  nextSteps: ["Open the alert's page and read what was around it"],
  confidence: "low",
}

/** The model's reply to a chat completion: the canned answer for what the brief is about. */
export const modelAnswer = async (request: Request): Promise<Response> => {
  const body = (await request.json()) as { messages?: ReadonlyArray<{ content?: unknown }> }
  const brief = (body.messages ?? [])
    .map((message) => (typeof message.content === "string" ? message.content : ""))
    .join("\n")
  const answer = answers.find(([about]) => about.test(brief))?.[1] ?? fallback
  return Response.json({
    choices: [{ message: { role: "assistant", content: JSON.stringify(answer) } }],
    usage: { prompt_tokens: 1800, completion_tokens: 240, total_tokens: 2040 },
  })
}
