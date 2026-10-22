/** @jsxImportSource solid-js */
/**
 * The overview's top (spec 0068): with an incident open, its impact, likely cause and who last wrote on it, and the
 * way to it; otherwise how many things need you. Beside it, small tiles, a vital's with its hour drawn.
 */
import { For, Show } from "solid-js"
import type { Events } from "../../shared/events"
import { useEstate } from "../context"
import { counted, initials, since } from "../format"
import { headlineOf, openedOf, tilesOf } from "../hero"
import type { Thing } from "../needs"
import { A } from "./A"
import { firstLine } from "./AlertLine"
import { Spark } from "./Sparkline"

export const Hero = (props: { readonly events: Partial<Events>; readonly things: ReadonlyArray<Thing> }) => {
  const { now } = useEstate()
  const headline = () => headlineOf(props.events)
  const opened = () => openedOf(props.events, props.things)
  const tone = () => opened()?.thing.tone ?? headline().tone
  return (
    <section aria-label="The estate now" class="now">
      <div class="now-words">
        <div class="stack">
          <span class={`kicker ${tone() === "healthy" ? "" : tone()}`}>
            <span class={`dot ${tone()} ${tone() === "healthy" ? "" : "hot"}`} />
            <Show when={opened()} fallback={headline().kicker}>
              {(incident) => `Incident open · ${counted(incident().thing.alerts.length, "alert").toLowerCase()}`}
            </Show>
          </span>
          <Show
            when={opened()}
            fallback={
              <>
                <h1 class="headline">
                  {headline().top}
                  <br />
                  {headline().bottom}
                </h1>
                <p class="lede">{headline().lede}</p>
              </>
            }
          >
            {(incident) => (
              <>
                <h1 class="headline hero-impact">{incident().impact}</h1>
                <Show when={incident().cause}>
                  {(cause) => (
                    <p class="hero-cause">
                      Likely cause: <strong>{cause().where}</strong>: {cause().text}.
                    </p>
                  )}
                </Show>
                <Show when={incident().latest}>
                  {(note) => (
                    <p class="hero-who">
                      <span class="avatar" aria-hidden="true">
                        {initials(note().by)}
                      </span>
                      <span>
                        <strong>{note().by}</strong>, {since(note().at, now())} ago: “{firstLine(note().text)}”
                      </span>
                    </p>
                  )}
                </Show>
                <div class="hero-actions">
                  <A to={incident().thing.to} class="primary-button">
                    Open the incident
                  </A>
                  <A to="/alerts" class="secondary-button">
                    All alerts
                  </A>
                </div>
              </>
            )}
          </Show>
        </div>
      </div>
      <div class="vitals">
        <For each={tilesOf(props.events)}>
          {(tile) => (
            <div class="vital">
              <Show
                when={tile.series}
                fallback={
                  <>
                    <span class="muted small">{tile.label}</span>
                    <span class="vital-value" classList={{ alarm: tile.alarm }}>
                      {tile.value}
                    </span>
                    <Show when={tile.note}>{(note) => <span class="muted small">{note()}</span>}</Show>
                  </>
                }
              >
                {(series) => <Spark label={tile.label} series={series()} unit={tile.unit ?? ""} />}
              </Show>
            </div>
          )}
        </For>
      </div>
    </section>
  )
}
