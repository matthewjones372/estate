/** @jsxImportSource solid-js */
/** A link within Estate: followed without reloading the page, keeping the environment. */
import type { JSX } from "solid-js"
import { useEstate } from "../context"

export const A = (props: {
  readonly to: string
  readonly children: JSX.Element
  readonly class?: string
  readonly current?: boolean
  readonly style?: JSX.CSSProperties
}) => {
  const { actions } = useEstate()
  const follow = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    actions.navigate(props.to)
  }
  return (
    <a
      href={props.to}
      onClick={follow}
      class={props.class}
      style={props.style}
      aria-current={props.current ? "page" : undefined}
    >
      {props.children}
    </a>
  )
}

/** A link out to another tool, in a new tab. */
export const Out = (props: { readonly href: string; readonly children: JSX.Element; readonly class?: string }) => (
  <a href={props.href} target="_blank" rel="noopener noreferrer" class={props.class}>
    {props.children}
  </a>
)
