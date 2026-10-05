/** @jsxImportSource solid-js */
/** Jump to a service, store, job or agent: the header field and ⌘K open the same palette. */
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Health } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { type JumpHit, type JumpKind, jumpHits, jumpRecent, recentHits, withHealth } from "../jump"
import { kept } from "../kept"

const kindTitles: Readonly<Record<JumpKind, string>> = {
  service: "Services",
  store: "Stores",
  job: "Jobs",
  agent: "Agents",
}

const healthWords: Readonly<Record<Health, string>> = {
  healthy: "Healthy",
  attention: "Degraded",
  critical: "Down",
  unknown: "Unknown",
}

const kindOrder: ReadonlyArray<JumpKind> = ["service", "store", "job", "agent"]
const storage = kept(jumpRecent.key)

export const Jump = () => {
  const { actions } = useEstate()
  const snapshot = useSnapshot()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(0)
  const [recents, setRecents] = createSignal(jumpRecent.read(() => storage.read()))
  let input: HTMLInputElement | undefined

  const catalog = () => snapshot.events.catalog
  const hits = () => {
    const q = query().trim()
    return q === "" ? recentHits(catalog(), recents()) : withHealth(jumpHits(catalog(), q), snapshot.events.services)
  }
  const groups = () =>
    kindOrder
      .map((kind) => ({ kind, title: kindTitles[kind], hits: hits().filter((hit) => hit.kind === kind) }))
      .filter((group) => group.hits.length > 0)

  createEffect(() => {
    hits()
    setActive(0)
  })

  const choose = (hit: JumpHit) => {
    const next = [
      { kind: hit.kind, name: hit.name, path: hit.path, ...(hit.hint === undefined ? {} : { hint: hit.hint }) },
      ...recents().filter((each) => !(each.kind === hit.kind && each.name === hit.name)),
    ]
    setRecents(next)
    jumpRecent.write((value) => storage.write(value), next)
    setOpen(false)
    setQuery("")
    input?.blur()
    actions.navigate(hit.path)
  }

  const close = () => {
    setOpen(false)
    setQuery("")
    input?.blur()
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen(true)
        input?.focus()
        return
      }
      if (!open()) return
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        return
      }
      const list = hits()
      if (list.length === 0) return
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActive((index) => (index + 1) % list.length)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setActive((index) => (index - 1 + list.length) % list.length)
      } else if (event.key === "Enter") {
        event.preventDefault()
        const hit = list[active()]
        if (hit !== undefined) choose(hit)
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <div class="jump">
      <div class="jump-field">
        <input
          ref={input}
          class="jump-input"
          type="search"
          placeholder="Search"
          aria-label="Jump to a service, store, job or agent"
          value={query()}
          onFocus={() => setOpen(true)}
          onInput={(event) => {
            setQuery(event.currentTarget.value)
            setOpen(true)
          }}
        />
        <kbd class="jump-chord">⌘K</kbd>
      </div>
      <Show when={open()}>
        <button type="button" class="jump-backdrop" aria-label="Close jump" onClick={close} />
        <div class="jump-palette" role="listbox" aria-label="Jump to">
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
                <section aria-label={group.title}>
                  <h2 class="jump-kind">{group.title}</h2>
                  <ul class="jump-list">
                    <For each={group.hits}>
                      {(hit) => {
                        const index = () => hits().findIndex((each) => each.kind === hit.kind && each.name === hit.name)
                        return (
                          <li>
                            <button
                              type="button"
                              class="jump-hit"
                              role="option"
                              aria-selected={index() === active()}
                              onMouseEnter={() => setActive(index())}
                              onClick={() => choose(hit)}
                            >
                              <span class="jump-name">{hit.name}</span>
                              <Show when={hit.hint}>
                                {(hint) => <span class="muted mono jump-hint">{hint()}</span>}
                              </Show>
                              <Show when={hit.health}>
                                {(health) => (
                                  <span class={`jump-health ${health()}`}>
                                    <span class={`dot ${health()}`} />
                                    {healthWords[health()]}
                                  </span>
                                )}
                              </Show>
                            </button>
                          </li>
                        )
                      }}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}
