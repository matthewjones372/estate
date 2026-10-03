/** @jsxImportSource solid-js */
/** Who owns something, by its team's title, and the team's links: its chat, its pages, its on-call. */
import { For, Show } from "solid-js"
import type { Team } from "../teams"
import { Out } from "./A"
import { Icon } from "./icons"
import { label } from "./Lane"

export const Owner = (props: { readonly owner: string | undefined; readonly team: Team | undefined }) => (
  <Show when={props.owner}>
    {(owner) => (
      <nav aria-label={`Owned by ${props.team?.title ?? owner()}`} class="links owner">
        <span class="muted">Owned by {props.team?.title ?? owner()}</span>
        <For each={props.team?.links ?? []}>
          {(link) => (
            <Out href={link.url} class="link-chip">
              <Icon name={link.name} />
              {label(link.name)}
            </Out>
          )}
        </For>
      </nav>
    )}
  </Show>
)
