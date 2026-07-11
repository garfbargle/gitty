export type RepoEntry = {
  id: string;
  name: string;
  path: string;
  hasUncommittedChanges?: boolean | null;
};

export type DiscoveredRepoEntry = RepoEntry & {
  lastEditedAt: number;
};

export type CommitEntry = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string;
  subject: string;
};

export type FileChange = {
  status: string;
  path: string;
  oldPath?: string | null;
};

export type RemoteEntry = {
  name: string;
  url: string;
  kind: string;
};

export type BranchEntry = {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string | null;
  tipHash?: string | null;
  tipShortHash?: string | null;
  lastCommitDate?: string | null;
  /// Commits this branch has that the current branch lacks (pull candidates).
  ahead?: number | null;
  /// Commits the current branch has that this branch lacks.
  behind?: number | null;
  aheadUpstream?: number | null;
  behindUpstream?: number | null;
};

/// How the checked-out branch sits relative to one reference branch (the trunk,
/// or this branch's own upstream), with the reference's divergent commits so the
/// timeline can draw a "context lane" showing how far behind the branch is.
export type BranchDivergence = {
  /// Display name of the reference (e.g. "main" or "origin/feature").
  refName: string;
  /// "integration" (the trunk) or "upstream" (this branch's remote).
  kind: "integration" | "upstream";
  /// Where HEAD and the reference last shared history. The lane forks here.
  mergeBase?: string | null;
  /// Commits the reference has that HEAD lacks — how far behind you are.
  behind: number;
  /// Commits HEAD has that the reference lacks — how far ahead you are.
  ahead: number;
  /// The reference's divergent commits since the merge-base, newest first.
  commits: CommitEntry[];
};

export type TagEntry = {
  name: string;
  date: string;
  shortHash: string;
  unpushed: boolean;
};

export type RepoChanges = {
  changes: FileChange[];
  isClean: boolean;
};

export type RepoEnrichment = {
  aheadCommits: CommitEntry[];
  aheadBranch?: string | null;
  tags: TagEntry[];
  unpushedTags: string[];
};

export type RepoSnapshot = {
  repo: RepoEntry;
  branch: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  changes: FileChange[];
  /// Linear HEAD ancestry — drives the working-tree timeline and picker.
  commits: CommitEntry[];
  /// Multi-branch history for the graph view; shows parallel lanes.
  graphCommits: CommitEntry[];
  aheadCommits: CommitEntry[];
  aheadBranch?: string | null;
  remotes: RemoteEntry[];
  branches: BranchEntry[];
  /// How the checked-out branch sits relative to the trunk and its own upstream,
  /// for the working-tree timeline's branch-context lanes.
  timelineContext: BranchDivergence[];
  /// The most recently active other branch (newer than trunk), for the single
  /// sibling lane on the timeline.
  siblingTip?: SiblingTip | null;
  tags: TagEntry[];
  unpushedTags: string[];
  /// The current branch exists locally but not on any remote, so pushing it
  /// would publish it — lights the push button even with no commits ahead.
  branchUnpublished?: boolean;
};

/// The most recently active branch other than the current one and the trunk,
/// surfaced only when its tip is newer than the trunk's.
export type SiblingTip = {
  name: string;
  tip: CommitEntry;
  /// Commits this branch has that HEAD lacks.
  ahead: number;
  /// Commits HEAD has that this branch lacks.
  behind: number;
};

export type ActionResult = {
  message: string;
  output: string;
};

export type AppSettingsView = {
  autoSummarizeEnabled: boolean;
  pushOnCommit: boolean;
  nvidiaApiKeyConfigured: boolean;
  nvidiaApiKeyPreview?: string | null;
};

export type ChangeSummary = {
  summary: string;
  fingerprint: string;
  scope: string;
  filesIncluded: number;
  filesSkipped: number;
};

export type ChangeSection = "unstaged" | "staged" | "commit";

export type ChangeSelectionEntry = {
  file: FileChange;
  section: ChangeSection;
};

export type SelectionAnchor = {
  section: ChangeSection;
  index: number;
  remainingSelection?: ChangeSelectionEntry[];
};

export type DiffFocus =
  | { kind: "commit"; commit: CommitEntry }
  | { kind: "file"; file: FileChange; section: ChangeSection }
  | null;

export type MergeOutcome = {
  status: "merged" | "fast_forward" | "conflicts" | "up_to_date";
  conflictFiles: string[];
  message: string;
  output: string;
  /// Set when the merge ran inside a linked worktree (merge into main). Conflict
  /// resolution and completion should target this path, not the main checkout.
  worktree?: string | null;
};

/// Outcome of updating (rebasing) the current branch onto another ref.
export type UpdateOutcome = {
  status: "updated" | "conflicts" | "up_to_date";
  conflictFiles: string[];
  message: string;
  output: string;
};

/// A folder in this repo that mirrors another repo (a git subtree), surfaced in
/// the UI as a "linked folder". History is the source of truth for which folders
/// are subtrees; the committed manifest (`.gitty/subtrees.json`) supplies the
/// origin URL/branch so Update is one click.
export type LinkedFolder = {
  prefix: string;
  /// Source repo URL. Empty when recovered from history without a manifest hint.
  url: string;
  /// Source ref/branch. Empty when unknown.
  branch: string;
  /// Short SHA of the source commit last pulled in.
  lastSyncedShort?: string | null;
  /// Whether the folder has uncommitted local edits.
  dirty: boolean;
  /// Whether Gitty knows this folder's origin. When false, the UI asks for the
  /// URL before the first Update.
  knownSource: boolean;
};

/// On-demand result of checking a linked folder against its source ref's tip.
/// Computed by a network `ls-remote`, kept separate from the offline folder list.
export type SubtreeUpdateStatus = {
  prefix: string;
  /// `true` the source moved on (Update will pull), `false` in sync, `null`
  /// couldn't tell (offline, unknown source, or no recorded sync point).
  updatesAvailable: boolean | null;
};

/// Whether an update (rebase) is paused mid-flight, so the UI can resume it.
export type UpdateStatus = {
  rebasing: boolean;
  conflictFiles: string[];
  resolvedFiles: string[];
};

export type MergeStatus = {
  merging: boolean;
  branch: string;
  conflictFiles: string[];
  resolvedFiles: string[];
};

export type ConflictSides = {
  ours: string;
  theirs: string;
  result: string;
  oursExists: boolean;
  theirsExists: boolean;
};
