/** @jsxImportSource solid-js */
/**
 * What an alert means for the people using the product, on its card: as written on the page (with who and when), in
 * the catalog, or on its rule. An operator writes it, edits it, or clears it back to the catalog's or the rule's.
 */
import { createSignal, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { since } from "../format"

export const Impact = (props: { readonly alert: Alert }) => {
  const { actions, me, now } = useEstate()
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const open = () => {
    setDraft(props.alert.impact?.from === "page" ? props.alert.impact.text : "")
    setEditing(true)
  }
  const save = () => void actions.setImpact(props.alert.name, draft().trim()).then((kept) => kept && setEditing(false))
  const operator = () => me.role === "operator" && me.kiosk !== true
  return (
    <Show
      when={editing()}
      fallback={
        <Show
          when={props.alert.impact}
          fallback={
            <Show when={operator()}>
              <button type="button" class="plain-button impact-add" onClick={open}>
                Add impact
              </button>
            </Show>
          }
        >
          {(impact) => (
            <p class="alert-impact">
              <span class="alert-label">Impact</span>
              <span>{impact().text}</span>
              <Show when={impact().by}>
                {(by) => (
                  <span class="muted">
                    {by()}
                    {impact().at === undefined ? "" : `, ${since(impact().at ?? "", now())} ago`}
                  </span>
                )}
              </Show>
              <Show when={operator()}>
                <button type="button" class="plain-button" onClick={open}>
                  Edit
                </button>
              </Show>
            </p>
          )}
        </Show>
      }
    >
      <form
        class="impact-form note-form"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <label>
          <span class="visually-hidden">What {props.alert.name} means for users</span>
          <input
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder="What it means for users, every time it fires"
            maxLength={500}
          />
        </label>
        <button type="submit" class="amber-button">
          {draft().trim() === "" ? "Clear" : "Save impact"}
        </button>
        <button type="button" class="plain-button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    </Show>
  )
}
