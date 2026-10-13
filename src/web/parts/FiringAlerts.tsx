/** @jsxImportSource solid-js */
/**
 * Many alerts at once: past a few firing, rows, grouped where they are one problem and worst first, each opening in
 * place; a few, their cards.
 */
import { For, Match, Switch } from "solid-js"
import type { Alert } from "../../shared/events"
import { type GroupBy, groupedOf } from "../grouped"
import { AlertCard } from "./AlertCard"
import { AlertGroup } from "./AlertGroup"
import { AlertRow, type Shown } from "./AlertRows"

/** More firing than this, and they are rows: two cards fill a laptop's width, four are about a screen. */
const fewest = 3

/** Whether these many firing show as rows rather than cards. */
export const asRows = (alerts: ReadonlyArray<Alert>) => alerts.length > fewest

export const FiringAlerts = (props: Shown & { readonly alerts: ReadonlyArray<Alert>; readonly by: GroupBy }) => (
  <Switch
    fallback={
      <div class="cards">
        <For each={props.alerts}>
          {(alert) => <AlertCard alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
        </For>
      </div>
    }
  >
    <Match when={asRows(props.alerts)}>
      <ul class="alert-rows">
        <For each={groupedOf(props.alerts, props.by)}>
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
