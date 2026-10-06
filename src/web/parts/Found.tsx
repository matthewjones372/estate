/** @jsxImportSource solid-js */
/** A service found rather than written (spec 0031): where it was found, and its entry to put in the catalog. */
import { createSignal, Show } from "solid-js"

interface Discovered {
  readonly from: string
  readonly yaml: string
}

const where = (from: string) => (from === "kubernetes" ? "Kubernetes" : from)

export const FoundMark = (props: { readonly discovered: Discovered | undefined }) => (
  <Show when={props.discovered}>{(found) => <span class="muted found">found in {where(found().from)}</span>}</Show>
)

/** On a found service's page: that it is not written, and its entry copied for the catalog. */
export const FoundEntry = (props: { readonly discovered: Discovered | undefined }) => {
  const [copied, setCopied] = createSignal(false)
  const copy = (yaml: string) =>
    void navigator.clipboard.writeText(yaml).then(
      () => setCopied(true),
      () => setCopied(false),
    )
  return (
    <Show when={props.discovered}>
      {(found) => (
        <p class="muted found-entry">
          Found in {where(found().from)}, not written in the catalog.{" "}
          <button type="button" class="plain-button" onClick={() => copy(found().yaml)}>
            {copied() ? "Copied" : "Copy as YAML"}
          </button>
        </p>
      )}
    </Show>
  )
}
