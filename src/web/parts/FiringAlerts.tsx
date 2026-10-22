/** @jsxImportSource solid-js */
/**
 * Many alerts at once as rows, an incident's grouped as one problem and worst first, each opening in place; or their
 * cards, as the layout chosen says.
 */
import { For, Match, Switch } from "solid-js"
import type { Alert } from "../../shared/events"
import { groupedOf } from "../grouped"
import { AlertCard } from "./AlertCard"
import { AlertGroup } from "./AlertGroup"
import { AlertRow, type Shown } from "./AlertRows"

export const FiringAlerts = (props: Shown & { readonly alerts: ReadonlyArray<Alert>; readonly rows: boolean }) => (
  <Switch
    fallback={
      <div class="cards">
        <For each={props.alerts}>
          {(alert) => <AlertCard alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
        </For>
      </div>
    }
  >
    <Match when={props.rows}>
      <ul class="alert-rows">
        <For each={groupedOf(props.alerts)}>
          {(entry) =>
            entry.kind === "alert" ? (
              <AlertRow alert={entry.alert} catalog={props.catalog} canSilence={props.canSilence} />
            ) : (
              <AlertGroup group={entry} catalog={props.catalog} canSilence={props.canSilence} />
            )
          }
        </For>
      </ul>
    </Match>
  </Switch>
)
