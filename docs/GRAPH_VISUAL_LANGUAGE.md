# One visual language for lanes, branches and history

A proposal. Nothing here is decided, and it deliberately does not overturn the
"no lane forest" rule in `SIMPLIFICATION_PLAN.md`.

## The problem

Gitty draws commit history in one place today, the horizontal working-tree
strip, and it encodes things inconsistently:

- Commit dots take a colour from `laneColor(index % 6)`, which is the commit's
  position in the array. Colour varies per commit and means nothing.
- Ghost commits (work on `main` you do not have) are hollow dots in a detached
  band, unlabelled. Nothing says they are commits, or that they are incoming.
- The one place colour would carry meaning, `onHead` versus not, is not drawn at
  all in the strip.

Meanwhile a second renderer exists and is unused. `buildGraphRows()` in
`src/lib/graph.ts` lays commits into stable lanes with real fork and merge
edges, keeps one colour per branch for its whole continuous run, and flags every
row and strand belonging to the checked-out branch as `onHead`. The Rust side
computes `graph_commits` through `graph_log_page()` on every snapshot to feed
it. Neither is referenced by any component.

So there are two half-built vocabularies: a strip that spends colour on nothing,
and a graph that would spend it on branch identity, sitting unused while costing
a git query per refresh.

## The grammar

Four channels, each with exactly one job, applied identically everywhere history
is drawn.

### Fill answers "do I have this?"

- **Solid** node: a commit in your history. You have it.
- **Hollow** node: a commit you do not have. Incoming work, or another branch's.

This is the single most useful distinction in the app and it is currently
implied only by position. It makes ghost commits self-explanatory: they look
like commits, and they are visibly not yours yet.

### Weight answers "is this my line?"

- **Full strength**: the branch you are on. `buildGraphRows` already computes
  this as `onHead`.
- **Reduced**: context. Other branches, other lanes, the trunk you forked from.

### Colour answers "which branch?" and nothing else

- Where **one** branch is drawn, as in the working-tree strip, there is no
  identity to distinguish, so colour is not spent on identity at all. It stays
  free for state: uncommitted work, conflicted, unpushed.
- Where **several** branches are drawn, colour separates lanes and stays with a
  branch for its whole run, which is what `buildGraphRows` already does.

The rule that makes this coherent: **colour never varies between two things of
the same kind unless it is telling you they are different branches.**
`index % 6` fails that test. Lane identity passes it.

### Shape and decoration answer "what state is this in?"

Reserved for genuinely stateful things and used sparingly: the dashed ring on
the working tree, a ring for a tagged commit, a marker for a conflict. Never
decorative.

## Two densities, one grammar

**Density A, the strip.** Stays the default and stays as Codi designed it: your
branch, plus at most the trunk and your upstream as context, plus one sibling
chip. What changes is only that it obeys the grammar. Your commits become
solid and full strength, ghosts become clearly hollow and labelled as incoming,
and the decorative rainbow goes away because in a single-branch view there is
no identity for colour to carry.

**Density B, the graph.** An on-demand view over `buildGraphRows` and the
`graph_commits` already being fetched. Many branches, so colour does identity
work here, your line is full strength via `onHead`, and anything not in your
history is hollow.

The point of one grammar across both is that moving between them teaches you
nothing new. A hollow dot means the same thing in each.

## What this does not do

- It does not turn the strip into a lane forest. Locked decision 2 stands.
- It does not make the graph the default view.
- It does not add git vocabulary to the interface.

## Open questions

- Is the vertical graph wanted at all, or is the right move to delete
  `buildGraphRows` and stop computing `graph_commits`, saving a git query per
  refresh? Either answer is an improvement on carrying it unused.
- Does "hollow means you do not have it" hold for a commit that is on another
  branch you already merged? It is in your history, so solid, which seems right.
- Ghost commits currently cap at 8 with a `+N` overflow. With clearer labelling,
  is the cap still the right call?
