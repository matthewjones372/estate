# 0044: Many alerts at once

## Problem

Spec 0025 put what is firing first: the overview's *Needs you now* (`src/web/pages/Overview.tsx`) shows every firing
alert as a full `AlertCard` (`src/web/parts/AlertCard.tsx`), above the vitals, the map and the services, and a
service's page does the same under *What's happening* (`src/web/parts/ServiceAlerts.tsx`). Each card carries its
severity and name, summary, impact, *Part of*, history, the around line, an hour's chart against its threshold, its
notes (`src/web/parts/Notes.tsx`, the newest three and a box to add one), and a row of up to eleven buttons, with Ask
AI's answer opening under them.

That reads well with two alerts. With twenty, as when a shared dependency fails, *Needs you now* is twenty of those
boxes, wrapped two or three across (`.cards` is a wrapping flex row), and the map and the services are a long
scroll below. Most of them are one problem, which the page cannot say. Notes, which spec 0039 folded to three, are
still most of a busy card. Matt's words: with 20 alerts in an environment "the ui would be horrible to view".

## Not doing

- **Fewer alerts.** Which alerts fire, and how they are routed, is the alert source's. Estate shows what fires.
- **Grouping by guess.** Alerts are grouped by what people decided (an incident, spec 0039) or what the catalog says
  (a service), not by similar names or labels. Spec 0042's suggestions are marked on their rows, never grouped.
- **A new Alerts page.** `/alerts` (`src/web/pages/Alerts.tsx`) keeps its table, filters and *Resolved today*.
- **The alert's own page and a past firing's page.** They show one alert; its card stays whole, notes open.
- **The kiosk.** A screen has no one to open a row; it stays as spec 0014 has it.

## Shape

**Rows past a few.** When more than three alerts are firing, *Needs you now* lists one row an alert in place of the
cards. Three or fewer, it shows cards, as now.

```text
Needs you now · 20 firing                                         [Auto] [Cards] [Rows]      All on Alerts →
▸ Chip registry slow        incident · 6 alerts · critical · open 15 min · latest: gil "registry restarted"
▸ orders                    service · 3 alerts · warning · since 11:44
  ● critical  PaymentsDown        payments    4 min   no notes                        May be part of "Checkout"
  ● warning   CartSlow            cart        9 min   ada: "looking at the cache"
  …
```

A row says, in one line: severity, the alert's name (a link to its page), its service or store, how long it has
been firing, its latest note (who and the first line), and its incident or suggestion. Pressing the row's toggle
opens its full card in place, under the row, and pressing it again closes it. Several can be open at once; which are
open is kept while Estate is open in the tab, as a card's *Show all notes* is (`allNotesShown` in
`src/web/parts/NoteText.tsx`), so following a link and coming back finds them as they were.

**Grouped, so one problem reads as one.** Before the single rows:

1. **By incident.** Firings linked into the same incident are one group row, titled with the incident, saying how
   many alerts, the worst severity, how long it has been open, and its latest note. It opens to its alerts' rows.
2. **By service or store.** Of the rest, two or more alerts on the same service or store are one group row.
3. The rest are single rows.

Groups and rows are ordered worst severity first, then longest firing. A group opens to rows, not cards, so opening
the incident of twelve alerts is twelve lines; each opens to its card. An alert is in one group at most: its
incident's, if it has one.

**Choosing.** *Auto*, *Cards* and *Rows* beside the heading, kept in the browser as `estate.alerts.layout` with
`kept` (`src/web/kept.ts`), as the services' list or grid choice is (`estate.services.layout` in
`src/web/parts/Lanes.tsx`). *Auto* is the default, and switches at more than three.

**Notes minimised on a card among others.** On the overview's and a service page's cards, and a card opened from a
row, notes show as one line:

```text
Notes · 5 · latest: ada 14:02 "vacuuming the orders table"      [Show notes]
```

*Show notes* opens spec 0039's fold (the newest three, *Show all*) and the box to add one; the choice is kept with
the card's other fold state. The alert's own page (`level={2}` on `AlertCard`) keeps them open, with the box, as
now. A card with no notes shows "No notes yet · Add a note".

**The service page.** *What's happening* uses the same rows past three, grouped by incident only (every alert there
is the same service).

**The Alerts page.** It stays the place for every alert, firing, pending and silenced, with filters, and its table
already is a row an alert. The two share what a row says: the latest note's line and the severity dot move into one
part both use. Its *Notes and silence* opens the card above the table, as now, with notes minimised. *Needs you now*
links to it ("All on Alerts") when it shows rows.

**Keyboard and screen readers.**

- The rows are a list (`<ul>`), each row an item. The alert's name is a link to its page; the toggle is a
  `<button aria-expanded aria-controls>` whose name is the alert and what it does: "Open OrdersSlow's card".
- A group's toggle is a button named with its count and worst severity: "Chip registry slow, 6 alerts, worst
  critical". Its rows follow it in a nested list.
- Opening moves no focus. The opened card follows its row in the page's order, so Tab goes into it next. Escape
  inside an opened card closes it and returns focus to its toggle.
- The heading says the count ("Needs you now · 20 firing"), so a screen reader hears the size before the list.
  New alerts are not announced as they arrive; the page streams, and a live region would talk through every change.
- *Auto*, *Cards* and *Rows* are a `fieldset` of `aria-pressed` buttons, as the services' layout is.

## Why this shape

A row is what a person scanning twenty alerts needs: what, where, how long, whether someone is on it. The card is
what they need once they have chosen one, so it opens in place rather than on another page, keeping the overview's
map and services a short scroll away. Grouping by incident uses the one grouping people have already decided, and
by service the one the catalog already says, so twenty alerts from one failure can read as two lines.

The alternatives: smaller cards, which are still twenty boxes; past a threshold, a line saying "20 firing, see
Alerts", which sends people away from the overview at the moment it matters; or the Alerts table on the overview,
which is built for filtering every state, not for opening one alert in place. Recommended: rows past three, grouped,
opening to the full card, with the choice kept per browser.

## Depends on

Spec 0039's incidents, for grouping. Spec 0042's suggestions are shown on rows once they land, and not before.

## Stack

- [ ] **`spec-0044-notes-minimised`**: notes on a card among others as one line, *Show notes* opening the fold and
      the box; the alert's own page keeps them open.
      Done when: `notes-fold.suite.tsx` shows "Notes · 5 · latest: …" and *Show notes* on an overview card, which
      opens the newest three and the box, kept on moving away and back; the alert's page shows them open.
- [ ] **`spec-0044-rows`**: `parts/AlertRows.tsx`, one row an alert opening its card in place, on *Needs you now*
      and *What's happening* past three firing; the row's line shared with the Alerts table.
      Done when: `alert-rows.suite.tsx` shows cards for three firing and rows for four, each row with its severity,
      name, service, time, latest note and incident; pressing a toggle opens that card under it with
      `aria-expanded` true, Escape closes it and focus returns to the toggle; two can be open at once.
- [ ] **`spec-0044-groups`**: group rows by incident, then by service or store, ordered worst first.
      Done when: six firings in one incident and three on one service read as two group rows and the rest single,
      each group named with its count and worst severity, opening to its rows; an alert in an incident is not also
      in its service's group.
- [ ] **`spec-0044-choice`**: *Auto*, *Cards* and *Rows*, kept as `estate.alerts.layout`.
      Done when: choosing *Cards* with five firing shows five cards, kept across a reload; *Auto* switches at four.

## Acceptance

```bash
bun run gate
```

Then, in the petshop's demo: `./chaos.sh registry-slow` and enough other chaos to fire more than three alerts; the
overview's *Needs you now* is rows, the incident's alerts one group, a row opens its card in place, and the map is
on the first screen below it.

## Open questions

- **Is three the threshold?** Recommended: yes; two cards fill a laptop's width, and four is two rows of cards, about
  a screen. *Cards* is there for whoever wants them always.
- **Should a critical alert open its card by itself when it fires?** Spec 0020 opens a map category that needs
  someone. Recommended: no; every row here needs someone, and a card opening by itself pushes the rows a person is
  reading. Critical rows sort first instead.
- **Should a group with one alert in it be a group?** Recommended: no; an incident or service with one firing alert
  is a single row, with its incident named on it.
- **Should notes be minimised on the alert's own page too?** Recommended: no; it is the page for one alert, where
  reading its notes is why someone came.
- **Should the Alerts page group by incident as well?** Recommended: not now; its filters and service select are its
  grouping, and it is where people go for the flat list.
