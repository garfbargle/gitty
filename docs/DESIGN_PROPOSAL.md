# Design observations and a proposed first pass

Notes from an outside read of Gitty's interface, written as suggestions rather
than decisions. Everything here is a proposal; the calls are yours.

The app already gets the hard parts right: it is fast, the working-tree timeline
is genuinely novel, and the contextual nudges ("You're working on main. Move
these changes to a branch to keep main clean.") do real teaching work that most
Git clients skip. What follows is about tightening communication, not
redirecting the product.

Findings are split by how arguable they are. The first group are defects with no
taste component. The second are systemic and additive. The third are opinions,
and the ones most likely to be wrong about intent we can't see from outside.

## 1. Defects

These are wrong regardless of design direction.

### Windows and Linux users are shown macOS keyboard glyphs

Five user-facing `<kbd>` elements hardcode `⌘`:

| File | Line |
| --- | --- |
| `src/components/PushButton.tsx` | 167 |
| `src/components/CommitPanel.tsx` | 351, 415 |
| `src/components/ChangesList.tsx` | 390 (plus a `title` tooltip at 387) |
| `src/App.tsx` | 3317 |

The behavior is correct: every handler tests `event.metaKey || event.ctrlKey`.
Only the label is wrong. A Windows user is told to press `⌘A` when the key they
need is `Ctrl`. The README already documents this correctly ("`Mod` is `⌘` on
macOS and `Ctrl` on Windows and Linux"), so the docs and the UI disagree.

Suggested fix: resolve the modifier once at startup and render it through a
small `<Shortcut>` component, so the glyph set lives in one place.

### Path shortening only works on macOS

`src/lib/git.ts:230`:

```ts
if (path.startsWith("/Users/")) {
```

On Windows (`C:\Users\name\Projects\x`) and Linux (`/home/name/…`), the home
directory is never abbreviated, so the sidebar renders full paths. Those are the
platforms where the path is longest, and the sidebar column is a fixed 220px, so
truncation lands hardest exactly where abbreviation fails.

### `prefers-reduced-motion` is never handled

Zero occurrences in `src/App.css`. The shell animates
`grid-template-columns` on sidebar toggle (line 132), among others. Users who
have asked their OS to reduce motion still get every transition.

Worth noting separately: animating `grid-template-columns` animates layout,
which forces reflow on each frame. A transform or width transition on the
sidebar would be cheaper.

### Type below the readable floor

Four rules set `font-size: 9px`, and three set `12.5px`. 9px is below what holds
up on a real display at a normal viewing distance, and the fractional size
rounds inconsistently across platforms.

### Grammar

`src/components/GittyEmptyState.tsx:19` reads "There's no changes in
<project>." Should be "There are no changes in <project>."

## 2. Foundations

Additive, and adoptable at whatever pace suits you. Nothing here forces a
visual change on its own.

### Type hierarchy is carried by weight, not size

`src/App.css` has 176 `font-size` declarations across nine values, nearly all
inside a 3px band:

| Size | Count |
| --- | --- |
| 12px | 62 |
| 11px | 55 |
| 10px | 34 |
| 13px | 10 |
| others (9, 12.5, 14, 15, 16) | 15 |

Adjacent steps differ by roughly 9%. Below about 1.25x, two sizes read as the
same size with a rendering inconsistency rather than as two levels.

With scale unavailable as a hierarchy signal, weight absorbs the load. Of 113
`font-weight` declarations, 102 are 600 or heavier (65 at 600, 37 at 700, 3 at
800). When most text is semibold, weight stops marking importance.

Suggested direction: a small set of type tokens with real ratio steps between
them, so size carries rank and weight returns to being an accent. This can be
introduced as variables and adopted rule by rule, with no big-bang rewrite.

### Spacing has no scale

Twenty distinct values, including every integer from 1px to 10px. Rhythm is hard
to establish when adjacent surfaces differ by a pixel for no reason. A spacing
scale as tokens would let padding decisions be made once rather than per rule.

### Layout is fixed above 1280px

The shell is `grid-template-columns: 220px minmax(0, 1fr)` with the commit panel
fixed at 260 to 280px. The only two media queries are both `max-width: 1280px`,
so above that width nothing adapts: surplus space goes entirely to the diff
while the sidebar stays at 220px and keeps truncating repository names
(`6RNDZ3R0-audio-g…`, `code-certificati…`).

`SplitPane` already exists and works well, but it is used once. Applying it to
the sidebar and commit panel would let the window be divided by the person using
it. This is the one foundational item that touches `App.tsx` structurally, so it
may be better split into its own change.

## 3. Opinions

Most likely to be wrong about intent. Offered as discussion, not as a patch.

### Color is spent on decoration while state is monochrome

`src/lib/graph.ts:30` defines seven lane colors cycled by index. In the
working-tree timeline, dots render blue, green, amber, red, purple, and cyan
across what is usually linear ancestry, so color varies per commit while
encoding nothing the user can act on.

Meanwhile the states that drive decisions (ahead, behind, dirty, staged versus
unstaged, unpushed, conflicted) are communicated through text and weight in
monochrome. The strongest perceptual channel is doing decorative work while the
information that matters competes in the weakest.

This is also an accessibility issue: where color does encode meaning, such as
diff add and delete, it is currently the only channel carrying it.

The suggestion is not "less color". It is to move the color budget onto state,
so a glance at the timeline answers "is this safe to send?" without reading.

There may well be a reason for per-commit lane colors in the multi-branch graph
view that does not apply to the linear timeline, in which case this is narrower
than it looks from outside.

### Type and monospace assume a platform

`--font-mono` leads with `"SF Mono"`, which resolves only on Apple systems.
Elsewhere it falls through to Consolas or a generic monospace, with different
metrics. Since diff alignment depends on the monospace face, the diff column
rhythm differs per platform. A stack that leads with a metric-consistent choice,
or a bundled face, would make the diff look the same everywhere.

## Suggested sequencing

1. **Defects.** Self-contained, no design opinion, independently mergeable.
2. **Foundations, tokens only.** Type and spacing scales added as variables,
   adopted incrementally.
3. **Layout flexibility.** Resizable sidebar and commit panel; behavior above
   1280px. Structural, so worth isolating.
4. **State and color.** Only if the direction in section 3 appeals.

Happy to take any subset, in any order, or none. If the state and color thinking
is off base for reasons that are not visible from the outside, that is useful to
know and costs nothing to say.
