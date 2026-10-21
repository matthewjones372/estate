/** @jsxImportSource solid-js */
/** A service or store found rather than written (specs 0031, 0057): where it was found, and its catalog entry. */
import { createSignal, Show } from "solid-js"

interface Discovered {
  readonly from: string
  readonly yaml: string
}

const places: Readonly<Record<string, string>> = {
  kubernetes: "Kubernetes",
  backstage: "Backstage",
  prometheus: "Prometheus",
}

const where = (from: string) => places[from] ?? from

export const FoundMark = (props: { readonly discovered: Discovered | undefined }) => (
  <Show when={props.discovered}>{(found) => <span class="muted found">found in {where(found().from)}</span>}</Show>
)

/** On a found service's or store's page: that it is not written, and its entry copied for the catalog. */
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
