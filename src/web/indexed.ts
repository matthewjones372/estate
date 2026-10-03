/**
 * Things looked up by a key, built once each time they change. A part drawn once per service that searched the whole
 * list for its own would read every service, so a thousand lanes read a million; through this, each reads one.
 */
import { type Accessor, createMemo } from "solid-js"

export const indexed = <T>(
  items: () => ReadonlyArray<T> | undefined,
  key: (item: T) => string,
): Accessor<ReadonlyMap<string, T>> => createMemo(() => new Map((items() ?? []).map((item) => [key(item), item])))

export const byName = <T extends { readonly name: string }>(items: () => ReadonlyArray<T> | undefined) =>
  indexed(items, (item) => item.name)
