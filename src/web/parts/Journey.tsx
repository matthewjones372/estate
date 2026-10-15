/** @jsxImportSource solid-js */
/**
 * A journey on a service's page: where its time goes over a sample of recent traces, as one bar with a segment per
 * stage, the stages' p50 and p99, and one of its traces in lanes. Read when it is opened, for its environment.
 */
import { createEffect, createSignal, For, on, Show } from "solid-js"
import type { JourneySample } from "../../shared/traces"
import { useEstate, useSnapshot } from "../context"
import { took } from "../format"
import { ExampleLanes } from "./ExampleLanes"

type Percentile = "p50" | "p99"

const whyWords: Readonly<Record<JourneySample["examples"][number]["why"], string>> = {
  slowest: "Slowest",
  failed: "Slowest that failed",
  typical: "Typical",
  fastest: "Fastest",
}

const spreadAt = (spread: { readonly p50?: number; readonly p99?: number }, at: Percentile) => spread[at]

/** The stage that takes longest at this percentile, by its place in the journey. */
const largestOf = (sample: JourneySample, at: Percentile): number =>
  sample.stages.reduce(
    (most, stage, index) =>
      (spreadAt(stage, at) ?? 0) > (spreadAt(sample.stages[most] ?? stage, at) ?? 0) ? index : most,
    0,
  )

const Read = (props: { readonly sample: JourneySample }) => {
  const [at, setAt] = createSignal<Percentile>("p50")
  // The typical trace is drawn first: it is the one most like what people meet.
  const [picked, setPicked] = createSignal(
    (props.sample.examples.find((example) => example.why === "typical") ?? props.sample.examples[0])?.id,
  )
  const total = () => spreadAt(props.sample.total, at()) ?? 0
  const answered = () => spreadAt(props.sample.answered, at()) ?? 0
  const largest = () => largestOf(props.sample, at())
  const share = () => {
    const stage = props.sample.stages[largest()]
    return stage === undefined || total() === 0 ? 0 : Math.round((100 * (spreadAt(stage, at()) ?? 0)) / total())
  }
  return (
    <>
      <div class="journey-top">
        <div class="stack" style={{ gap: "6px" }}>
          <p class="journey-headline">
            It reaches its end in {took(total())} at {at()}. {share()}% of that is{" "}
            {props.sample.stages[largest()]?.title}.
          </p>
          <p class="muted">
            The caller has an answer in {took(answered())}. {props.sample.sampled} traces from the last{" "}
            {props.sample.minutes} min, from Tempo.
          </p>
        </div>
        <fieldset class="choices">
          <legend class="visually-hidden">Percentile</legend>
          <For each={["p50", "p99"] as const}>
            {(each) => (
              <button type="button" class="choice" aria-pressed={at() === each} onClick={() => setAt(each)}>
                {each}
              </button>
            )}
          </For>
        </fieldset>
      </div>
      <div class="journey-bar" aria-hidden="true">
        <For each={props.sample.stages}>
          {(stage, index) => (
            <span
              class="journey-segment"
              classList={{ "trace-wait": stage.kind === "gap", "trace-hot": index() === largest() }}
              style={{ "flex-grow": spreadAt(stage, at()) ?? 0 }}
              title={`${stage.title}: ${took(spreadAt(stage, at()) ?? 0)}`}
            />
          )}
        </For>
      </div>
      <div class="table-box">
        <table class="journey-stages">
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Where</th>
              <th scope="col">From the trace</th>
              <th scope="col" class="number">
                p50
              </th>
              <th scope="col" class="number">
                p99
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={props.sample.stages}>
              {(stage, index) => (
                <tr classList={{ "journey-largest": index() === largest() }}>
                  <th scope="row">
                    {stage.title}
                    <Show when={stage.found < props.sample.sampled}>
                      <span class="muted">
                        {" "}
                        · in {stage.found} of {props.sample.sampled}
                      </span>
                    </Show>
                  </th>
                  <td>{stage.where.title}</td>
                  <td class="mono">{stage.text}</td>
                  <td class="number mono">{stage.p50 === undefined ? "–" : took(stage.p50)}</td>
                  <td class="number mono">{stage.p99 === undefined ? "–" : took(stage.p99)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
      <Show when={props.sample.examples.length > 0}>
        <fieldset class="choices journey-examples">
          <legend class="visually-hidden">The trace drawn in lanes</legend>
          <For each={props.sample.examples}>
            {(example) => (
              <button
                type="button"
                class="choice"
                aria-pressed={picked() === example.id}
                onClick={() => setPicked(example.id)}
              >
                {whyWords[example.why]} · {took(example.total)}
              </button>
            )}
          </For>
        </fieldset>
        <Show when={picked()}>{(id) => <ExampleLanes journey={props.sample.name} id={id()} />}</Show>
      </Show>
    </>
  )
}

/** Closed until asked: a sample is many reads of Tempo, and a lot to take in beside the rest of the page. */
const JourneyPanel = (props: { readonly name: string; readonly title: string }) => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [open, setOpen] = createSignal(false)
  const [read, setRead] = createSignal<JourneySample | "none" | "loading" | undefined>("loading")
  createEffect(
    on([open, () => props.name, () => snapshot.environment], ([shown, name]) => {
      if (!shown) return
      setRead("loading")
      void actions.journey(name).then(setRead)
    }),
  )
  const id = () => `journey-${props.name}`
  return (
    <section aria-labelledby={id()} class="panel section-box">
      <div class="journey-head">
        <div class="stack" style={{ gap: "4px" }}>
          <h2 id={id()} class="section-title">
            {props.title}
          </h2>
          <Show when={!open()}>
            <p class="muted journey-hint">Where its time goes, from a sample of its recent traces.</p>
          </Show>
        </div>
        <button
          type="button"
          class="plain-button"
          aria-expanded={open()}
          aria-controls={`${id()}-body`}
          onClick={() => setOpen((now) => !now)}
        >
          {open() ? "Hide" : "Show where its time goes"}
        </button>
      </div>
      <Show when={open()}>
        <div id={`${id()}-body`} class="stack" style={{ gap: "14px" }}>
          <Show when={read() !== "loading"} fallback={<p class="muted">Reading its traces…</p>}>
            <Show
              when={read() !== "none"}
              fallback={<p class="muted">There is no Tempo here to read its traces from.</p>}
            >
              <Show when={read()} fallback={<p class="muted">Its traces could not be read.</p>}>
                {(sample) => {
                  const found = () => sample() as JourneySample
                  return (
                    <Show
                      when={found().sampled > 0}
                      fallback={<p class="muted">No trace of it in the last {found().minutes} min.</p>}
                    >
                      <Read sample={found()} />
                    </Show>
                  )
                }}
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  )
}

/** The journeys this service is part of. */
export const Journeys = (props: { readonly service: string }) => {
  const snapshot = useSnapshot()
  const journeys = () =>
    (snapshot.events.catalog?.journeys ?? []).filter((journey) => journey.services.includes(props.service))
  return <For each={journeys()}>{(journey) => <JourneyPanel name={journey.name} title={journey.title} />}</For>
}
