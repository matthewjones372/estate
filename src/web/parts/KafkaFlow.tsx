/** @jsxImportSource solid-js */
/** A line messages flow along (spec 0057): faster and thicker the more a second, still with none. */
import { flowStep } from "../kafka"

export const Flow = (props: { readonly rate: number | null; readonly behind?: boolean }) => (
  <svg
    class={`kafka-flow step-${flowStep(props.rate)}${props.behind === true ? " behind" : ""}`}
    viewBox="0 0 100 10"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <line x1="0" y1="5" x2="94" y2="5" />
    <polygon points="94,1 100,5 94,9" />
  </svg>
)
