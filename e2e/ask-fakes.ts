/** What Ask AI reads in the example estate: OrdersSlow's runbook, and a self-hosted model answering from the brief. */
/** OrdersSlow's runbook, kept as Markdown in the repository it names. */
export const runbook = `# Orders are slow

If p99 is high after a deploy, roll back. If the database is the cause, check for long-running vacuums.
`

/** A self-hosted model behind the OpenAI-compatible API, answering from the brief it was sent. */
export const modelAnswer = async (request: Request) => {
  const body = await request.json()
  const brief: string = body.messages?.at(-1)?.content ?? ""
  const answer = {
    likelyCause: brief.includes("stalled")
      ? "orders' new version never rolled out: its image policy cannot list tags."
      : "Nothing in the brief explains it.",
    evidence: [{ text: brief.split("\n").find((line) => line.includes("stalled")) ?? "no change near it" }],
    nextSteps: ["Fix the registry credentials Flux uses for orders"],
    confidence: "medium",
  }
  return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 1200 } })
}
