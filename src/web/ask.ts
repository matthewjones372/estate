/** Structured answer from Ask AI about an alert (streamed then finalized). */
export interface AskAnswer {
  readonly likelyCause: string
  readonly evidence: ReadonlyArray<{ readonly text: string; readonly href?: string }>
  readonly nextSteps: ReadonlyArray<string>
  readonly confidence: "low" | "medium" | "high"
  readonly tools: ReadonlyArray<string>
  readonly model: string
}
