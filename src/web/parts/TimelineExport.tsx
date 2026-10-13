/** @jsxImportSource solid-js */
/** Beside a timeline's heading: Copy as Markdown, saying whether it was copied, and Download as Markdown or JSON. */
import { createSignal } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { type Exported, timelinePath } from "../timeline-path"

/** Whether the text reached the clipboard; a page outside a secure context has none to write to. */
const toClipboard = (text: string): Promise<string> =>
  navigator.clipboard === undefined
    ? Promise.resolve("This browser has no clipboard for Estate here.")
    : navigator.clipboard.writeText(text).then(
        () => "Copied",
        () => "The browser would not let it be copied.",
      )

export const TimelineExport = (props: { readonly of: Exported }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [busy, setBusy] = createSignal(false)
  const [outcome, setOutcome] = createSignal<string | undefined>(undefined)
  const copy = () => {
    setBusy(true)
    setOutcome(undefined)
    void actions
      .timelineMarkdown(props.of)
      .then((read) => (typeof read === "string" ? read : toClipboard(read.text)))
      .then((result) => {
        setBusy(false)
        setOutcome(result)
      })
  }
  const href = (format: "md" | "json") => timelinePath(props.of, snapshot.environment, format)
  return (
    <div class="timeline-export">
      <button type="button" class="plain-button" disabled={busy()} aria-busy={busy()} onClick={copy}>
        Copy as Markdown
      </button>
      <span class="muted">Download</span>
      <a href={href("md")} download="" aria-label="Download the timeline as Markdown">
        Markdown
      </a>
      <a href={href("json")} download="" aria-label="Download the timeline as JSON">
        JSON
      </a>
      {/* There before it says anything: a status that appears with its words is not read out. */}
      <span class="muted" role="status">
        {outcome() ?? ""}
      </span>
    </div>
  )
}
