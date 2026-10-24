/** @jsxImportSource solid-js */
/** What an alert is about, as a link to its page: its service's, or else its store's. */
import { Show } from "solid-js"
import { pathOf } from "../route"
import { A } from "./A"

export const Subject = (props: { readonly service: string | undefined; readonly store: string | undefined }) => (
  <Show
    when={props.service}
    fallback={
      <Show when={props.store}>{(store) => <A to={pathOf({ page: "store", name: store() })}>{store()}</A>}</Show>
    }
  >
    {(service) => <A to={pathOf({ page: "service", name: service() })}>{service()}</A>}
  </Show>
)
