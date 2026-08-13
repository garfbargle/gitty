# Gitty

The standing product document: who this is for, what is settled, and the rules a
change has to satisfy. It promotes into decisions what `docs/DESIGN_PROPOSAL.md`
raised as suggestions and `docs/GRAPH_VISUAL_LANGUAGE.md` raised as a proposal.
Those two stay as the reasoning and the measurements behind the calls; this file
is the call.

register: product

## Purpose

A cross-platform desktop Git client (Tauri 2, React 19, Rust) that shells out to
the system `git` binary rather than embedding a Git library. It opens on a map
of the repository: the trunk at the centre and the folders carrying work around
it. Home is the focused view of the folder open now and its changes.

## Users

Developers who use Git daily and would rather not think in Git, explicitly
including people who have never opened a terminal. The maintainer runs it as his
own daily client, which is the real acceptance test: it has to survive being
someone's actual tool, not demo well.

Two shapes of use both matter:

- **One repository, one checkout.** The common case, and the one the timeline is
  tuned for.
- **One repository, many checkouts.** A real user of this project keeps ~20
  worktrees on one repository. Anything rendered per-checkout has to survive
  twenty of them without turning into a wall. This is why the folder count
  collapsed to a single chip with a menu rather than a row of chips.

## Locked decisions

From `docs/SIMPLIFICATION_PLAN.md`, unchanged:

1. **No Git vocabulary in the interface.** "Update from main", "Merge into
   main", "folder". Never rebase, subtree, worktree, detached HEAD. The code
   says worktree; the interface says folder. One word per concept, everywhere.
2. **"Update from main" is always `git rebase --autostash`.** One predictable
   behaviour.
3. **Nothing moves the user's files without a clearly-worded ask.** Removing a
   folder deletes it from disk, so it gets a dialog that says so, names the
   folder, and states what is not deleted. A trash icon beside a row is not an
   ask.
4. **The workspace map is the default.** It shows the trunk, every open folder,
   which folder is open here, local uncommitted changes, and whether a folder's
   committed work is already in the trunk. The commit graph sits beneath it for
   detail. Home remains compact: the current folder, its changes, and the
   focused timeline — no lane forest there.
5. **Worktrees are a hidden engine**, so work on another branch never changes the
   user's checkout underneath them.
6. **Push force is always `--force-with-lease`.**

## The visual grammar

From `docs/GRAPH_VISUAL_LANGUAGE.md`. Four channels, one job each, applied
identically wherever history is drawn. The purpose of one grammar across two
densities is that moving between them teaches you nothing new.

| Channel | Answers | Encoding |
| --- | --- | --- |
| Fill | Do I have this? | Solid: in your history. Hollow: not yours yet. |
| Weight | Is this my line? | Full strength on `onHead`, reduced for context. |
| Colour | Which branch? | Nothing else. |
| Shape, decoration | What state is this in? | Sparingly. Never decorative. |

The governing rule: **colour never varies between two things of the same kind
unless it is telling you they are different branches.** `laneColor(index % 6)`
fails that test, which is why the strip does not spend colour on identity: with
one branch drawn there is no identity to carry, so colour stays free for state.
The graph draws many branches, so there colour does identity work and stays with
a branch for its whole run.

**Two densities, one grammar.** The workspace map and its dense graph are the
default: they establish the shape of work across folders. Home is deliberately
compact: your current folder, its changes, your branch, the trunk, your
upstream, and at most one sibling.

## Interface rules

Settled by the first round of design work and now standing:

- **Type carries rank.** An explicit scale with real ratios between steps. When
  nine font sizes sat inside a 3px band, hierarchy fell entirely to weight, and
  102 of 113 weight declarations were 600 or heavier. Size ranks; weight
  emphasises.
- **State is never asserted without evidence.** Three states, not two, wherever
  freshness or sync is shown: known-good, known-stale, and *unknown*. Saying
  "in sync" about a remote never contacted, or naming a branch you are not on,
  is a defect and not a rounding error.
- **Chrome is not data.** The "Now" entry is chrome and must not read as a
  scrollable history item.
- **Selection is a cursor, not a fill.** Selection indicates; it does not
  compete with the content it points at, and it leaves colour free for state.
- **Platform-agnostic polish.** Keyboard hints resolve per platform, paths
  shorten on all three. Not Apple-flavoured.
- **Motion is optional.** `prefers-reduced-motion` removes it, and layout
  properties are not animated.

## Tone

Plain, specific, unhurried. Consequences stated before destructive actions in
the user's own terms. No exclamation, no cheerleading, no implementation
vocabulary leaking into the interface. Error text explains what to do, rather
than repeating what git printed.

## Anti-references

- Lane forests: every branch as a rainbow strand, mistaken for information.
- Git's raw error text shown to the user.
- Decorative colour. The named failure is colour that varies per commit while
  meaning nothing.
- Interfaces that assert unverified state.
- Apple-specific styling. Polished and platform-agnostic, not Apple-like.

## How changes arrive

This repository is a fork whose `main` is the head of a pull request upstream.
Changes are proposals: separable, individually droppable, with opinion labelled
as opinion and kept apart from defect. A defect is wrong regardless of design
direction; everything else is a suggestion the maintainer can decline.
