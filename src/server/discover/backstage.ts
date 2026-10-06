/**
 * Services found in Backstage (spec 0033): the Components a rule's filter matches, page by page, each made the catalog
 * entry its own fields say, its owner, system, links and the annotations Backstage's plugins use, with the rule's
 * template filling the rest.
 */
import { Effect, Redacted, Schema } from "effect"
import type { DiscoverRule } from "../../shared/catalog"
import { callJson, type Remote } from "../remote"
import type { Backstage } from "../settings-backstage"
import { type Failure, SourceFailure } from "../sources/run"
import { filled } from "./kubernetes"

const optional = Schema.optionalKey
const Strings = Schema.Record(Schema.String, Schema.String)

const Component = Schema.Struct({
  metadata: Schema.Struct({
    name: Schema.String,
    description: optional(Schema.String),
    annotations: optional(Strings),
    labels: optional(Strings),
    links: optional(Schema.Array(Schema.Struct({ url: Schema.String, title: optional(Schema.String) }))),
  }),
  spec: optional(Schema.Struct({ owner: optional(Schema.String), system: optional(Schema.String) })),
})
export type Component = typeof Component.Type

const Page = Schema.Struct({
  items: Schema.Array(Component),
  pageInfo: optional(Schema.Struct({ nextCursor: optional(Schema.String) })),
})

/** As many pages as a catalog of a few thousand Components needs, and no more if Backstage keeps answering. */
const most = 50

/** The Components a filter matches, every page of them. */
export const componentsIn = (
  backstage: Backstage,
  filter: string,
): Effect.Effect<ReadonlyArray<Component>, Failure, Remote> => {
  const base = backstage.url.replace(/\/$/, "")
  const headers = backstage.token === undefined ? {} : { authorization: `Bearer ${Redacted.value(backstage.token)}` }
  const page = (cursor: string | undefined, read: ReadonlyArray<Component>, count: number) =>
    Effect.gen(function* (): Effect.fn.Return<ReadonlyArray<Component>, Failure, Remote> {
      const query =
        cursor === undefined ? `filter=${encodeURIComponent(filter)}&limit=500` : `cursor=${encodeURIComponent(cursor)}`
      const body = yield* callJson({ url: `${base}/api/catalog/entities/by-query?${query}`, headers }).pipe(
        Effect.mapError((error) => new SourceFailure({ message: `Backstage ${error.message}` })),
      )
      const answered = yield* Schema.decodeUnknownEffect(Page)(body).pipe(
        Effect.mapError(() => new SourceFailure({ message: "Backstage answered in a shape Estate does not know" })),
      )
      const all = [...read, ...answered.items]
      const next = answered.pageInfo?.nextCursor
      return next === undefined || count + 1 >= most ? all : yield* page(next, all, count + 1)
    })
  return page(undefined, [], 0)
}

/** An owner as Backstage writes it, `group:default/payments`, as the catalog names it: `payments`. */
const ownerOf = (owner: string) => owner.replace(/^[\w-]+:/, "").replace(/^[\w-]+\//, "")

const keyOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** The entry a Component becomes, in `environments`, before it is checked as a written one is. */
export const entryOf = (rule: DiscoverRule, environments: ReadonlyArray<string>, component: Component): unknown => {
  const { metadata, spec } = component
  const annotations = metadata.annotations ?? {}
  const namespace = annotations["backstage.io/kubernetes-namespace"]
  const links = metadata.links ?? []
  const runbook = links.find((link) => /^runbook$/i.test(link.title ?? ""))?.url ?? annotations["estate.dev/runbook"]
  const slug = annotations["github.com/project-slug"]
  const others = links.filter((link) => !/^runbook$/i.test(link.title ?? "") && keyOf(link.title ?? "") !== "")
  const { environments: _, ...template } = rule.service ?? {}
  const fromTemplate = filled(template, {
    service: metadata.name,
    ...(namespace === undefined ? {} : { namespace }),
    labels: metadata.labels ?? {},
    annotations,
  }) as { readonly links?: Readonly<Record<string, string>> }
  const linked = {
    ...fromTemplate.links,
    ...Object.fromEntries(others.map((link) => [keyOf(link.title ?? ""), link.url])),
  }
  return {
    ...fromTemplate,
    name: metadata.name,
    environments: rule.service?.environments ?? environments,
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
    ...(spec?.owner === undefined ? {} : { owner: ownerOf(spec.owner) }),
    ...(spec?.system === undefined ? {} : { category: spec.system }),
    ...(slug === undefined ? {} : { repository: `github:${slug}` }),
    ...(runbook === undefined ? {} : { runbook }),
    ...(Object.keys(linked).length === 0 ? {} : { links: linked }),
    ...(namespace === undefined
      ? {}
      : {
          kubernetes: {
            namespace,
            workloads: [{ kind: "Deployment", name: annotations["backstage.io/kubernetes-id"] ?? metadata.name }],
          },
        }),
    discovered: { from: "backstage" },
  }
}
