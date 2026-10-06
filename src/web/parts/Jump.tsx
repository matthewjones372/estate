/** @jsxImportSource solid-js */
/**
 * Jump to a service, store, job or agent: a search field in the header, and ⌘K (Ctrl K) from anywhere. It is a
 * combobox: focus stays in the field while the arrow keys move through the results, so a screen reader follows.
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useEstate, useSnapshot } from "../context"
import { healthWords } from "../format"
import { type JumpHit, type JumpKind, jumpHits, jumpRecent, recentHits, withHealth } from "../jump"
import { kept } from "../kept"

const kindTitles: Readonly<Record<JumpKind, string>> = {
  service: "Services",
  store: "Stores",
  job: "Jobs",
  agent: "Agents",
}

const kindOrder: ReadonlyArray<JumpKind> = ["service", "store", "job", "agent"]
const storage = kept(jumpRecent.key)
const optionId = (index: number) => `jump-option-${index}`
/** The chord as this computer writes it. */
const chord = () => (/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? "⌘K" : "Ctrl K")

export const Jump = () => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const [recents, setRecents] = createSignal(jumpRecent.read(() => storage.read()))
  let input: HTMLInputElement | undefined
  // Where focus was when ⌘K opened the palette, to go back to when it closes.
  let before: HTMLElement | undefined

  const catalog = () => snapshot.events.catalog
  const hits = () => {
    const q = query().trim()
    return q === "" ? recentHits(catalog(), recents()) : withHealth(jumpHits(catalog(), q), snapshot.events.services)
  }
  const groups = () =>
    kindOrder
      .map((kind) => ({ kind, title: kindTitles[kind], hits: hits().filter((hit) => hit.kind === kind) }))
      .filter((group) => group.hits.length > 0)
  const indexOf = (hit: JumpHit) => hits().findIndex((each) => each.kind === hit.kind && each.name === hit.name)

  createEffect(() => {
    hits()
    setActive(0)
  })

  const close = (restore: boolean) => {
    setOpen(false)
    setQuery("")
    const back = before
    before = undefined
    if (restore && back !== undefined && back.isConnected) back.focus()
    else if (document.activeElement === input) input?.blur()
  }

  const choose = (hit: JumpHit) => {
    const next = [
      { kind: hit.kind, name: hit.name, path: hit.path, ...(hit.hint === undefined ? {} : { hint: hit.hint }) },
      ...recents().filter((each) => !(each.kind === hit.kind && each.name === hit.name)),
    ]
    setRecents(next)
    jumpRecent.write((value) => storage.write(value), next)
    close(false)
    actions.navigate(hit.path)
  }

  const onKey = (event: KeyboardEvent) => {
    const list = hits()
    if (event.key === "Escape") {
      event.preventDefault()
      close(true)
    } else if (event.key === "ArrowDown" && list.length > 0) {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (index + 1) % list.length)
    } else if (event.key === "ArrowUp" && list.length > 0) {
      event.preventDefault()
      setActive((index) => (index - 1 + list.length) % list.length)
    } else if (event.key === "Enter" && open()) {
      const hit = list[active()]
      if (hit === undefined) return
      event.preventDefault()
      choose(hit)
    }
  }

  onMount(() => {
    const onChord = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return
      event.preventDefault()
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused !== input) before = focused
      setOpen(true)
      input?.focus()
    }
    window.addEventListener("keydown", onChord)
    onCleanup(() => window.removeEventListener("keydown", onChord))
  })

  return (
    <div
      class="jump"
      // Listened for on the element itself, not delegated to the document: tabbing or clicking away closes it.
      on:focusout={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node && event.currentTarget.contains(next))) close(false)
      }}
    >
      <div class="jump-field">
        <input
          ref={input}
          class="jump-input"
          type="search"
          role="combobox"
          placeholder="Search"
          aria-label="Jump to a service, store, job or agent"
          aria-autocomplete="list"
          aria-expanded={open()}
          aria-controls="jump-palette"
          aria-activedescendant={open() && hits().length > 0 ? optionId(active()) : undefined}
          value={query()}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setOpen(true)
          }}
        />
        <kbd class="jump-chord">{chord()}</kbd>
      </div>
      <Show when={open()}>
        <div class="jump-palette" id="jump-palette" role="listbox" aria-label="Jump to">
          <Show
            when={groups().length > 0}
            fallback={
              <p class="jump-empty muted">
                {query().trim() === "" ? "Jump somewhere to keep it here." : "Nothing matches."}
              </p>
            }
          >
            <For each={groups()}>
              {(group) => (
                <>
                  <div class="jump-kind" aria-hidden="true">
                    {group.title}
                  </div>
                  <For each={group.hits}>
                    {(hit) => (
                      <button
                        type="button"
                        id={optionId(indexOf(hit))}
                        class="jump-hit"
                        role="option"
                        tabIndex={-1}
                        aria-selected={indexOf(hit) === active()}
                        aria-label={`${hit.name}, ${group.title.toLowerCase().replace(/s$/, "")}`}
                        onMouseEnter={() => setActive(indexOf(hit))}
                        // Keep focus in the field, so choosing does not close the palette first.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(hit)}
                      >
                        <span class="jump-name">{hit.name}</span>
                        <Show when={hit.hint}>{(hint) => <span class="muted mono jump-hint">{hint()}</span>}</Show>
                        <Show when={hit.health}>
                          {(health) => (
                            <span class={`jump-health ${health()}`}>
                              <span class={`dot ${health()}`} />
                              {healthWords[health()]}
                            </span>
                          )}
                        </Show>
                      </button>
                    )}
                  </For>
                </>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
