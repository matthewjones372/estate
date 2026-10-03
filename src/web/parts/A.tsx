/** A link within Estate: followed without reloading the page, keeping the environment. */
import type { CSSProperties, MouseEvent, ReactNode } from "react"
import { useEstate } from "../context"

export const A = (props: {
  readonly to: string
  readonly children: ReactNode
  readonly className?: string
  readonly current?: boolean
  readonly style?: CSSProperties
}) => {
  const { actions } = useEstate()
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    actions.navigate(props.to)
  }
  return (
    <a
      href={props.to}
      onClick={follow}
      className={props.className}
      style={props.style}
      aria-current={props.current ? "page" : undefined}
    >
      {props.children}
    </a>
  )
}

/** A link out to another tool, in a new tab. */
export const Out = (props: { readonly href: string; readonly children: ReactNode; readonly className?: string }) => (
  <a href={props.href} target="_blank" rel="noopener noreferrer" className={props.className}>
    {props.children}
  </a>
)
