export type RepoEntry = {
  id: string;
  name: string;
  path: string;
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
  tags: TagEntry[];
  unpushedTags: string[];
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

export type VisitSession = {
  returnBranch: string;
  returnHead?: string;
  visitedCommit: CommitEntry;
  stashed: boolean;
};

export type MergeAnalysis = {
  source: string;
  target: string;
  commits: CommitEntry[];
  files: FileChange[];
  conflictFiles: string[];
  hasConflicts: boolean;
  conflictsKnown: boolean;
  workingTreeClean: boolean;
  targetBehind: number;
  targetHasUpstream: boolean;
  alreadyUpToDate: boolean;
  sourceBehind: number;
  fastForward: boolean;
  sourceIsCurrent: boolean;
  targetIsCurrent: boolean;
};

export type MergeOutcome = {
  status: "merged" | "fast_forward" | "conflicts" | "up_to_date";
  conflictFiles: string[];
  message: string;
  output: string;
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

// Direction of a merge in the UI: shipping the current branch into the base,
// or pulling the base back into the current branch.
export type MergeDirection = "ship" | "update";

export type MergePhase = "preview" | "merging" | "conflicts" | "done";

export type MergeSession = {
  source: string;
  target: string;
  direction: MergeDirection;
  phase: MergePhase;
  /// Branch to return to when the session ends (the branch the user started on).
  returnBranch: string;
};
