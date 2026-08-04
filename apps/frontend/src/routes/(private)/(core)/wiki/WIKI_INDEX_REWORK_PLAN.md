# Wiki `/wiki` Index Rework Plan

## Context / What's changing
The sidebar tree was replaced with a **focused sidebar**: breadcrumb chips at top, then siblings of the current context, then children. No sprawl. Path-jumping is via breadcrumb; lateral movement via siblings list; downward via children list. Header still has `Contexts` / `Tags` / search.

The `/wiki` index (root landing) still uses the old design: two-column layout with a "Top-Level Contexts" grid + "Recently Updated" aside. It needs to become a proper landing hub that plays with the new sidebar model.

## Problems with current `/wiki`
1. Only shows root contexts as cards — not a real "landing" (no favorites, no pinned articles, no quick jump to nested contexts).
2. Duplicates sidebar affordances: sidebar already lists top-level contexts, so the big grid on the page is redundant.
3. "New Context" and "New Article" buttons compete with the sidebar's own affordances.
4. Recent activity is boxed into a narrow aside and cuts off after a handful.
5. Doesn't teach the reader *how* to use the wiki — no scent of Tags, no scent of search-first workflow.

## Design direction
Make `/wiki` an operational **hub** — the first thing you land on that tells you "what happened, what's mine, where to go" and gives you fast paths to it. The sidebar handles hierarchy; the index handles activity + shortcuts.

### Proposed layout (top → bottom)

**1. Compact hero band** — no big title. One row:
- Left: `Knowledge Base` label + subtitle (`N articles across M contexts`).
- Right: primary CTAs — `New article`, `New context`. Overflow menu for import/export later.

**2. Quick-jump strip** (chips, wraps)
- Recently visited contexts (per-user, stored in localStorage, top ~6).
- Pinned contexts (future: server-side; localStorage placeholder OK).
- Empty state: `Visit a context to pin it here.`

**3. Two-column body (grid, lg:grid-cols-[minmax(0,1fr)_22rem]):**

**Left column — Recent activity feed**
- List (not cards), 15–20 rows. Each row:
  - Icon, title, `KBxxx`, breadcrumb context path (`Root / Sub / Sub`), author, `relativeTime`, lock badge if locked, tag chips.
- Group by day: `Today`, `Yesterday`, `Last 7 days`, `Earlier`.
- Filter tabs at top: `All` · `Mine` · `Recently updated` · `Recently viewed`. Client-side.
- "See all activity" link at the bottom → future full activity page (not built now).

**Right column — Discovery / scaffolding**
- **Contexts overview** card: top-level contexts as a compact list (small icon + name + descendant-article count). NOT the big card grid — sidebar covers the browse-tree role.
- **Popular tags** card: top ~12 tags by article count as colored chips → each links to `/wiki/tags?tag=<id>` (future: preselect the tag).
- **Search tip** card: 2-line explainer of `Ctrl+K`, `KB####` jump, and `tag:`/`context:` prefixes. Replaces some of the footer text.

**4. Empty states**
- If zero contexts: single centered card with `Create your first context` + a 1-2 sentence explanation of contexts vs. tags. Same as current, but full-page not aside-anchored.
- If zero articles but some contexts: hero shows "Start writing" CTA prominently; activity list shows onboarding tips.

### Interaction / data notes
- **Recently visited** — write to localStorage `wiki.recentContexts` (array of `{id, visitedAt}`, capped at ~20) whenever the wiki layout sees `activeContextId` change. Read on `/wiki`.
- **Pinned contexts** — start localStorage-only (`wiki.pinnedContexts`), toggled from the sidebar breadcrumb (star icon) or the quick-jump chip's kebab menu. Server persistence deferred.
- **Filter tabs** — pure client-side over `wiki.articles.list` + a new `wiki.articles.recent` variant with author info (already returned by `recent.query`).
- **Popular tags** — reuse `wiki.tags.list` which already carries `articleCount`.
- No new tRPC endpoints required for v1.

### Visual language
- Match the focused sidebar: same chip style for pins/recents as breadcrumb chips. Reuse the tag pill style everywhere. Consistent `Folder` / `FileText` iconography.
- Use `bg-card/40` panels with `border` — same as the sidebar for continuity. No dashed borders except for empty states.
- Keep density low on the hub — this is a landing page, not a working surface. Working happens in category pages and `/wiki/[id]`.

## Component work required
- `wiki/+page.svelte`: rewrite. Keep tRPC queries (contexts.list, articles.list, articles.recent, tags.list).
- New small helper `wiki/_recent-contexts.svelte.ts` — thin localStorage-backed store; `record(id)` / `list()` / `pin(id)` / `unpin(id)`.
- Optional: extract activity-row into a snippet or component (also used by future activity page).
- Sidebar breadcrumb (`+layout.svelte`) gets a star toggle to pin the current context. Minor addition, ~10 lines.

## Out of scope for v1
- Server-side pinning / per-user favorites persistence.
- Full activity page beyond the hub feed.
- Notifications / mentions on the hub.
- Draft management on the hub (drafts belong on the article page).
- Reworking `/wiki/tags` further — already improved.

## Rollout order (small commits)
1. localStorage helper + record recent context visits from the layout.
2. Rewrite `/wiki` body: quick-jump strip + activity feed + right-rail cards. No pinning yet.
3. Add pin toggle to sidebar breadcrumb + wire into the quick-jump strip.
4. Filter tabs on the activity feed (`All / Mine / Updated / Viewed`).
5. Polish empty states.

Each step is independently mergeable and each keeps the current index behavior working until swapped.
