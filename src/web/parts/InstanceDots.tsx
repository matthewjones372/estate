/** @jsxImportSource solid-js */
/** A database's instances on its lane (spec 0060): the primary filled, each replica a ring, amber when behind, gone dashed. */
import { For, Show } from "solid-js"
import type { ServicesEvent } from "../../shared/events"

type Instances = NonNullable<NonNullable<ServicesEvent["stores"]>[number]["instances"]>

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** The dots in words, for a screen reader. */
const wordsOf = (instances: Instances) =>
  [
    counted(instances.primaries, "primary", "primaries"),
    `${counted(instances.replicas, "replica", "replicas")}${instances.behind > 0 ? `, ${instances.behind} of them behind` : ""}`,
    ...(instances.gone > 0 ? [`${instances.gone} gone`] : []),
  ].join(", ")

const dotsOf = (instances: Instances) => [
  ...Array.from({ length: instances.primaries }, () => "primary"),
  ...Array.from({ length: Math.min(instances.behind, instances.replicas) }, () => "replica behind"),
  ...Array.from({ length: Math.max(0, instances.replicas - instances.behind) }, () => "replica"),
  ...Array.from({ length: instances.gone }, () => "gone"),
]

export const InstanceDots = (props: { readonly instances: Instances | undefined }) => (
  <Show when={props.instances}>
    {(instances) => (
      <span class="instance-dots" role="img" aria-label={wordsOf(instances())}>
        <For each={dotsOf(instances())}>{(kind) => <span class={`instance-dot ${kind}`} />}</For>
      </span>
    )}
  </Show>
)
