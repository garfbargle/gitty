import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { Check, FolderPlus, GitBranch, PanelLeft, RefreshCw } from "lucide-react";
import { ChangesList, type ChangesListHandle } from "./components/ChangesList";
import { CommitPanel } from "./components/CommitPanel";
import { ConflictResolver } from "./components/ConflictResolver";
import { DiffViewer } from "./components/DiffViewer";
import { buildDiffBundles, type DiffFileBundle } from "./lib/diff";
import { HistoryTimeline } from "./components/HistoryTimeline";
import { SplitPane } from "./components/SplitPane";
import { AppSettingsDrawer } from "./components/AppSettingsDrawer";
import { RepoSettingsDrawer } from "./components/RepoSettingsDrawer";
import { RepoSidebar } from "./components/RepoSidebar";
import { TopBar } from "./components/TopBar";
import { GittyEmptyState } from "./components/GittyEmptyState";
import { ResetAllConfirmDialog } from "./components/ResetAllConfirmDialog";
import { ResetToCommitDialog } from "./components/ResetToCommitDialog";
import { DiscardFilesConfirmDialog } from "./components/DiscardFilesConfirmDialog";
import { TagCreateDialog } from "./components/TagCreateDialog";
import { BranchCreateDialog } from "./components/BranchCreateDialog";
import { TagDeleteDialog } from "./components/TagDeleteDialog";
import { ActionRunnerDrawer } from "./components/ActionRunnerDrawer";
import { ActivityFeed } from "./components/ActivityFeed";
import type { PullPhase } from "./components/PullButton";
import type { PushPhase } from "./components/PushButton";
import type {
  ActionExecutionState,
  ActionLogEntry,
  ActionResult,
  AppSettingsView,
  ChangeSection,
  ChangeSelectionEntry,
  ChangeSummary,
  CommitEntry,
  DiffFocus,
  DiscoveredRepoEntry,
  FileChange,
  LinkedFolder,
  RepoAction,
  RepoEntry,
  RepoChanges,
  RepoEnrichment,
  RepoFocusState,
  RepoSnapshot,
  RepoSortMode,
  SelectionAnchor,
  MergeOutcome,
  MergeStatus,
  UpdateOutcome,
  UpdateStatus,
  ConflictSides,
  WorktreeEntry,
} from "./types";
import { changePathsKey, isStaged, isUnstaged, stagedPathsKey } from "./lib/git";
import { timestampLogOutput } from "./lib/logs";
import { getLine, replaceLine } from "./lib/fileEdit";
import { buildChangeEntries, moveChangeSelection } from "./lib/changeEntries";
import { INITIAL_COMMIT_LIMIT } from "./lib/commits";
import {
  checkSubtreePublishable,
  checkSubtreeUpdates,
  listLinkedFolders,
  pushLinkedFolder,
} from "./lib/subtrees";
import {
  buildTimelineItems,
  moveTimelineSelection,
  timelineSelectionIndex,
} from "./lib/timelineNavigation";
import { SHORTCUT } from "./lib/shortcuts";
import { useShortcut } from "./lib/useShortcut";
import {
  shouldIgnoreEnterShortcut,
  shouldIgnoreKeyboardNavigation,
} from "./lib/keyboardFocus";
import { KeyboardSheet } from "./components/KeyboardSheet";
import { sortRepos } from "./lib/repoSort";
import { GraphView } from "./components/GraphView";
import { RemoveWorktreeConfirmDialog } from "./components/RemoveWorktreeConfirmDialog";
import "./App.css";

const emptyDiff = "Select a file or commit to view its diff.";

type GitProgress = {
  path: string;
  phase: string;
  message: string;
};

type BackupSetupResult = ActionResult & { synced: boolean };

function discoveredInsertIndex(repos: DiscoveredRepoEntry[], lastEditedAt: number): number {
  let lo = 0;
  let hi = repos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (repos[mid].lastEditedAt > lastEditedAt) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upsertDiscoveredRepo(
  current: DiscoveredRepoEntry[],
  repo: DiscoveredRepoEntry,
): DiscoveredRepoEntry[] {
  const existingIndex = current.findIndex((item) => item.path === repo.path);
  if (existingIndex !== -1) {
    const existing = current[existingIndex];
    if (existing.lastEditedAt === repo.lastEditedAt) {
      return current;
    }
    const without = current.slice(0, existingIndex).concat(current.slice(existingIndex + 1));
    const insertAt = discoveredInsertIndex(without, repo.lastEditedAt);
    const next = without.slice();
    next.splice(insertAt, 0, { ...existing, lastEditedAt: repo.lastEditedAt });
    return next;
  }

  const insertAt = discoveredInsertIndex(current, repo.lastEditedAt);
  const next = current.slice();
  next.splice(insertAt, 0, repo);
  return next;
}

type NavZone = "timeline" | "files";

// The single "integrate with main" operation. `update` rebases the current
// branch onto main; `merge` merges it into main inside a hidden worktree.
type IntegrationOp = {
  kind: "update" | "merge" | "subtree";
  /// Trunk name we're integrating with (the "other" side; "ours" in conflicts).
  onto: string;
  /// The current branch being integrated ("theirs" in conflicts).
  branch: string;
  /// For a `merge` with conflicts: the trunk worktree where resolution happens.
  worktree?: string;
  phase: "conflicts" | "done";
  /// A finished merge left main ahead of its remote — offer to push it.
  pushable?: boolean;
  /// For a `subtree` update: the linked folder being pulled (for labels).
  prefix?: string;
};


type SummaryScope = "all" | "staged";

type SummaryCacheEntry = {
  pathsKey: string;
  summary: ChangeSummary;
};

type SummaryCache = {
  all: SummaryCacheEntry | null;
  staged: SummaryCacheEntry | null;
  displayScope: SummaryScope;
};

type RepoGitActivity = {
  message: string;
  error: string;
};

function emptySummaryCache(): SummaryCache {
  return { all: null, staged: null, displayScope: "staged" };
}

const SNAPSHOT_SUPERSEDED = "__superseded__";
const SIDEBAR_VISIBLE_KEY = "gitty.sidebarVisible";
const REPO_SORT_KEY = "gitty.repoSort";
const STATUS_MESSAGE_DISMISS_MS = 4_000;
// Fetch shortly after returning to Gitty, then periodically while it stays
// open. This keeps remote status useful without turning every render or local
// refresh into a network request.
const AUTO_FETCH_MIN_INTERVAL_MS = 15_000;
const AUTO_FETCH_INTERVAL_MS = 5 * 60_000;

const repoSortModes = new Set<RepoSortMode>([
  "manual",
  "name-asc",
  "name-desc",
  "recent",
  "changes",
]);

function readSidebarVisible(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

function readRepoSortMode(): RepoSortMode {
  try {
    const saved = localStorage.getItem(REPO_SORT_KEY);
    return saved && repoSortModes.has(saved as RepoSortMode)
      ? (saved as RepoSortMode)
      : "manual";
  } catch {
    return "manual";
  }
}

function isSupersededSnapshotError(err: unknown): boolean {
  return String(err).includes(SNAPSHOT_SUPERSEDED);
}

// Yield until the busy state we just set has painted. macOS stops serving
// animation frames to an occluded window, so the rAF pair alone would stall the
// work behind it until the user came back — a push started right before an
// alt-tab would sit on "Pushing…" without ever running. The timeout keeps that
// case moving; when frames are flowing the rAF pair wins well before it fires.
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 50);
    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
  });
}

function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredRepoEntry[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [viewingCommit, setViewingCommit] = useState<CommitEntry | null>(null);
  const [viewingCommitMessage, setViewingCommitMessage] = useState("");
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([]);
  // The one integration operation in flight: rebasing the current branch onto
  // main ("update"), or merging it into main ("merge"). Null when idle.
  const [integrationOp, setIntegrationOp] = useState<IntegrationOp | null>(null);
  const [integrationRunning, setIntegrationRunning] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  const [conflictSides, setConflictSides] = useState<ConflictSides | null>(null);
  const [conflictSidesLoading, setConflictSidesLoading] = useState(false);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [diffBundles, setDiffBundles] = useState<DiffFileBundle[]>([]);
  const [diffSelection, setDiffSelection] = useState<ChangeSelectionEntry[]>([]);

  useEffect(() => {
    if (diff === emptyDiff) {
      setDiffBundles([]);
    }
  }, [diff]);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [pushOnCommit, setPushOnCommit] = useState(false);
  const [resetMode, setResetMode] = useState<"soft" | "hard">("soft");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  // Linked folders whose source has moved on, driving the top-bar chip. Computed
  // on the network only at deliberate moments (repo open + fetch), never polled.
  const [behindFolders, setBehindFolders] = useState<LinkedFolder[]>([]);
  // Known-source linked folders that can be published (subtree push). Instant/
  // local — publishing is deliberate, so this isn't gated on a network check.
  const [publishableFolders, setPublishableFolders] = useState<LinkedFolder[]>([]);
  const [linkedPushBusyPrefix, setLinkedPushBusyPrefix] = useState<string | null>(null);
  const [linkedBusyPrefix, setLinkedBusyPrefix] = useState<string | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [discardFilesOpen, setDiscardFilesOpen] = useState(false);
  const [discardFilesTarget, setDiscardFilesTarget] = useState<string[]>([]);
  const [tagCreateCommit, setTagCreateCommit] = useState<CommitEntry | null>(null);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
  // When set, the branch dialog forks from this commit rather than HEAD.
  const [branchFromCommit, setBranchFromCommit] = useState<CommitEntry | null>(null);
  // When set, the reset dialog offers to move HEAD to this commit.
  const [resetToTarget, setResetToTarget] = useState<CommitEntry | null>(null);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<{
    commit: CommitEntry;
    name: string;
  } | null>(null);
  const [nvidiaApiKeyConfigured, setNvidiaApiKeyConfigured] = useState(false);
  const [nvidiaApiKeyPreview, setNvidiaApiKeyPreview] = useState<string | null>(null);
  const [autoSummarizeEnabled, setAutoSummarizeEnabled] = useState(true);
  const [fetchOnRefresh, setFetchOnRefresh] = useState(false);
  const [backupRemoteName, setBackupRemoteName] = useState("backup");
  const [backupUrlTemplate, setBackupUrlTemplate] = useState("");
  const [savedBackupRemoteName, setSavedBackupRemoteName] = useState("backup");
  const [savedBackupUrlTemplate, setSavedBackupUrlTemplate] = useState("");
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupSaveMessage, setBackupSaveMessage] = useState<string | null>(null);
  const [backupSaveError, setBackupSaveError] = useState(false);
  const [nvidiaApiKey, setNvidiaApiKey] = useState("");
  const [settingsNvidiaKey, setSettingsNvidiaKey] = useState("");
  const [nvidiaKeyTesting, setNvidiaKeyTesting] = useState(false);
  const [nvidiaKeyTestMessage, setNvidiaKeyTestMessage] = useState<string | null>(null);
  const [nvidiaKeyTestError, setNvidiaKeyTestError] = useState(false);
  const [changeSummaryScope, setChangeSummaryScope] = useState<SummaryScope>("staged");
  const [changeSummary, setChangeSummary] = useState<string | null>(null);
  const [changeSummaryLoading, setChangeSummaryLoading] = useState(false);
  const [changeSummaryError, setChangeSummaryError] = useState<string | null>(null);
  const [changeSummaryVisible, setChangeSummaryVisible] = useState(false);
  const [workspaceSplit, setWorkspaceSplit] = useState(0.3);
  const [loading, setLoading] = useState(false);
  const [pushPhases, setPushPhases] = useState<Record<string, PushPhase>>({});
  const [backupPhases, setBackupPhases] = useState<Record<string, PushPhase>>({});
  const [fetchingPaths, setFetchingPaths] = useState<Record<string, boolean>>({});
  const [gitActivityByPath, setGitActivityByPath] = useState<Record<string, RepoGitActivity>>({});
  const pushPhase = pushPhases[selectedPath] ?? "idle";
  const backupPhase = backupPhases[selectedPath] ?? "idle";
  const fetching = fetchingPaths[selectedPath] ?? false;
  const [pullPhase, setPullPhase] = useState<PullPhase>("idle");
  // Set when a normal push is rejected as non-fast-forward, so the push button
  // surfaces the force-push affordance even without a fresh fetch.
  const [pushRejected, setPushRejected] = useState(false);
  const [message, setMessageValue] = useState("");
  const [error, setErrorValue] = useState("");
  const messageDismissTimerRef = useRef<number | null>(null);
  // The Git tab is also used for one-off Git actions, so timestamp their
  // completed output just like the streamed push and backup activity.
  const setMessage = useCallback((next: string) => {
    if (messageDismissTimerRef.current !== null) {
      window.clearTimeout(messageDismissTimerRef.current);
      messageDismissTimerRef.current = null;
    }
    setMessageValue(next ? timestampLogOutput(next) : "");
    if (next) {
      messageDismissTimerRef.current = window.setTimeout(() => {
        setMessageValue("");
        messageDismissTimerRef.current = null;
      }, STATUS_MESSAGE_DISMISS_MS);
    }
  }, []);
  const setError = useCallback((next: string) => {
    setErrorValue(next ? timestampLogOutput(next) : "");
  }, []);
  const [navZone, setNavZone] = useState<NavZone>("files");
  const [sidebarVisible, setSidebarVisible] = useState(readSidebarVisible);
  const [keyboardSheetOpen, setKeyboardSheetOpen] = useState(false);
  const [repoSortMode, setRepoSortMode] = useState<RepoSortMode>(readRepoSortMode);
  /// Preview of the two densities in docs/GRAPH_VISUAL_LANGUAGE.md: the
  /// working-tree strip, or the full branch graph over `graphCommits`.
  const [historyView, setHistoryView] = useState<"strip" | "graph">("strip");
  const [repoActions, setRepoActions] = useState<RepoAction[]>([]);
  /// Other checkouts of this repository. Drives the branch switcher (a branch
  /// open in another folder can't be checked out here, so we offer to open that
  /// folder instead) and the graph's "open elsewhere" marker.
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  /// Pending folder removal, held here so the confirmation is App's and the
  /// settings panel stays presentational.
  const [worktreeToRemove, setWorktreeToRemove] = useState<WorktreeEntry | null>(null);
  const [removingWorktree, setRemovingWorktree] = useState(false);
  /// Bumped whenever something mutates the checkout list.
  const [worktreeRefresh, setWorktreeRefresh] = useState(0);
  const [selectedRepoActionId, setSelectedRepoActionId] = useState("");
  const [terminalSessions, setTerminalSessions] = useState<ActionExecutionState[]>([]);
  const [drawerSessionId, setDrawerSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPath) {
      setRepoActions([]);
      return;
    }
    let cancelled = false;
    invoke<RepoAction[]>("detect_repo_actions", { path: selectedPath })
      .then((actions) => {
        if (!cancelled) {
          setRepoActions(actions);
        }
      })
      .catch(() => {
        if (!cancelled) setRepoActions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  // Refreshed alongside the snapshot, since checking a branch out or removing a
  // checkout changes this list.
  useEffect(() => {
    let cancelled = false;
    if (!selectedPath) {
      setWorktrees([]);
      return;
    }
    invoke<WorktreeEntry[]>("list_worktrees", { path: selectedPath })
      .then((result) => {
        if (!cancelled) setWorktrees(result.filter((entry) => !entry.internal));
      })
      .catch(() => {
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath, snapshot?.branch, worktreeRefresh]);

  useEffect(() => {
    if (!selectedPath || repoActions.length === 0) {
      setSelectedRepoActionId("");
      return;
    }

    const storedActionId = localStorage.getItem(`gitty.defaultAction:${selectedPath}`);
    const preferredAction =
      repoActions.find((action) => action.id === storedActionId) ||
      repoActions.find((action) => action.command.includes("tauri build")) ||
      repoActions.find((action) => action.command.includes("dev")) ||
      repoActions.find((action) => action.command.includes("build")) ||
      repoActions[0];
    setSelectedRepoActionId(preferredAction.id);
  }, [selectedPath, repoActions]);

  useEffect(() => {
    const unlistenOutput = listen<{ actionId: string; line: string; stream: "stdout" | "stderr" }>(
      "action-runner-output",
      (event) => {
        setTerminalSessions((sessions) =>
          sessions.map((session) => {
            if (session.runId !== event.payload.actionId) return session;
            const newLog: ActionLogEntry = {
              id: `${Date.now()}-${Math.random()}`,
              line: event.payload.line,
              stream: event.payload.stream,
              timestamp: Date.now(),
            };
            return {
              ...session,
              logs: [...session.logs, newLog],
            };
          })
        );
      }
    );

    const unlistenFinished = listen<{ actionId: string; success: boolean; exitCode?: number | null; error?: string | null }>(
      "action-runner-finished",
      (event) => {
        setTerminalSessions((sessions) =>
          sessions.map((session) => {
            if (session.runId !== event.payload.actionId) return session;
            return {
              ...session,
              status: event.payload.success ? "success" : "error",
              endTime: Date.now(),
              exitCode: event.payload.exitCode ?? (event.payload.success ? 0 : 1),
            };
          })
        );
      }
    );

    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenFinished.then((fn) => fn());
    };
  }, []);

  const handleRunAction = useCallback(
    (action: RepoAction) => {
      if (!selectedPath) return;
      const runId = `run:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const execution: ActionExecutionState = {
        runId,
        repoPath: selectedPath,
        action,
        status: "running",
        startTime: Date.now(),
        logs: [
          {
            id: `start-${Date.now()}`,
            line: `$ ${action.command}`,
            stream: "stdout",
            timestamp: Date.now(),
          },
        ],
      };
      setTerminalSessions((sessions) => [...sessions, execution]);
      setDrawerSessionId(null);

      invoke("execute_repo_action", {
        path: selectedPath,
        actionId: runId,
        command: action.command,
      }).catch((err) => {
        setTerminalSessions((sessions) =>
          sessions.map((session) =>
            session.runId === runId
              ? {
                  ...session,
                  status: "error",
                  endTime: Date.now(),
                  logs: [
                    ...session.logs,
                    {
                      id: `err-${Date.now()}`,
                      line: `Execution error: ${String(err)}`,
                      stream: "stderr",
                      timestamp: Date.now(),
                    },
                  ],
                }
              : session
          )
        );
      });
    },
    [selectedPath]
  );

  const handleRunCustomCommand = useCallback(
    (cmd: string) => {
      const customAction: RepoAction = {
        id: `custom:${Date.now()}`,
        name: cmd,
        command: cmd,
        category: "custom",
        description: "Custom command",
      };
      handleRunAction(customAction);
    },
    [handleRunAction]
  );

  const handleSelectRepoAction = useCallback(
    (action: RepoAction) => {
      setSelectedRepoActionId(action.id);
      localStorage.setItem(`gitty.defaultAction:${selectedPath}`, action.id);
    },
    [selectedPath],
  );

  useShortcut("runAction", () => {
    const selectedAction =
      repoActions.find((action) => action.id === selectedRepoActionId) ?? repoActions[0];
    if (!selectedPath || !selectedAction) return;
    handleRunAction(selectedAction);
  });

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(next));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  const selectedCommit =
    viewingCommit ?? (focus?.kind === "commit" ? focus.commit : null);
  const selectedFile = focus?.kind === "file" ? focus.file : null;
  const selectedFileKey =
    focus?.kind === "file" ? `${focus.section}:${focus.file.path}` : undefined;
  const workingTreeActive = !viewingCommit;

  const branchNames = useMemo(() => {
    const branches = snapshot?.branches ?? [];
    const local = branches.filter((b) => !b.isRemote).map((b) => b.name);
    const remote = branches.filter((b) => b.isRemote).map((b) => b.name);
    return [...local, ...remote];
  }, [snapshot]);

  // The project's integration branch (the trunk you ship into).
  const integrationBranch = useMemo(() => {
    const locals = (snapshot?.branches ?? [])
      .filter((b) => !b.isRemote)
      .map((b) => b.name);
    if (locals.includes("main")) return "main";
    if (locals.includes("master")) return "master";
    return null;
  }, [snapshot?.branches]);

  // You're sitting on the trunk — there's nothing to update from or ship to it.
  const onIntegrationBranch =
    !!snapshot && !!integrationBranch && snapshot.branch === integrationBranch;

  const branchDetached = snapshot?.branch.includes("detached") ?? false;

  // How the current branch sits against the trunk, from the timeline's own
  // integration lane: `behind` = commits main has that you lack (update to get
  // them), `ahead` = your commits main lacks (merge to ship them).
  const integrationLane = useMemo(
    () => (snapshot?.timelineContext ?? []).find((lane) => lane.kind === "integration"),
    [snapshot?.timelineContext],
  );
  const behindMain = integrationLane?.behind ?? 0;
  const aheadOfMain = integrationLane?.ahead ?? 0;

  // The two moves, offered only off the trunk, on a real branch, when idle.
  const canIntegrate =
    !!integrationBranch && !onIntegrationBranch && !branchDetached;
  const canUpdateFromMain = canIntegrate && behindMain > 0;
  const canMergeIntoMain = canIntegrate && aheadOfMain > 0;

  const sortedRepos = useMemo(() => sortRepos(repos, repoSortMode), [repos, repoSortMode]);
  const sortedDiscoveredRepos = useMemo(
    () => sortRepos(discoveredRepos, repoSortMode),
    [discoveredRepos, repoSortMode],
  );
  const savedPaths = useMemo(() => repos.map((repo) => repo.path), [repos]);
  const contentPath = snapshot?.repo.path ?? "";
  const displaySnapshot =
    snapshot && snapshot.repo.path === selectedPath ? snapshot : null;
  const repoSwitching = Boolean(selectedPath && contentPath !== selectedPath);
  const switchingRepoName =
    repos.find((repo) => repo.path === selectedPath)?.name ?? "repository";
  const discoveryStarted = useRef(false);
  const selectRepoRequestRef = useRef(0);
  // Async Git work can finish after the user selects another repository. Keep
  // the current choice outside render closures so its completion can never
  // restore the repository it started in.
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;
  const commitMessageRef = useRef<HTMLTextAreaElement>(null);
  const focusRefreshContextRef = useRef({
    selectedPath,
    viewingCommit,
    focus,
  });
  focusRefreshContextRef.current = { selectedPath, viewingCommit, focus };
  const changesListRef = useRef<ChangesListHandle>(null);
  const selectionPreserveRef = useRef(0);
  const loadDiffRequestRef = useRef(0);
  // Undo/redo stack for inline line edits. Each entry snapshots a file's whole
  // contents before and after one edit so undo/redo can rewrite it exactly,
  // even after the diff view has been rebuilt.
  const editHistoryRef = useRef<{
    past: { filePath: string; before: string; after: string }[];
    future: { filePath: string; before: string; after: string }[];
  }>({ past: [], future: [] });
  const pushLockRef = useRef(new Set<string>());
  const backupLockRef = useRef(new Set<string>());
  const fetchLockRef = useRef(new Set<string>());
  const lastAutoFetchAtRef = useRef(new Map<string, number>());
  const autoFetchRepoRef = useRef<(path: string) => void>(() => {});
  const pushDoneTimerRef = useRef(new Map<string, number>());
  const backupDoneTimerRef = useRef(new Map<string, number>());
  const pullLockRef = useRef(false);
  const pullDoneTimerRef = useRef<number | null>(null);
  const workingTreeRefreshInFlightRef = useRef(false);
  const focusRefreshTimerRef = useRef<number | null>(null);
  const lastFocusRefreshAtRef = useRef(0);
  const focusFingerprintByPathRef = useRef(new Map<string, string>());
  const snapshotGenerationRef = useRef(0);
  const changesRefreshRequestRef = useRef(0);
  /// Guards the commit preview the same way the others guard their reads.
  /// inspectCommit sets the viewed commit, then awaits its files and diff; with
  /// nothing to compare against, an inspection still in flight when you press
  /// "Back to now" landed afterwards and put the commit's files and diff back
  /// on screen. Bumped on return-to-now so those late writes are dropped.
  const commitInspectRef = useRef(0);
  const FOCUS_REFRESH_DEBOUNCE_MS = 400;
  const FOCUS_REFRESH_MIN_INTERVAL_MS = 2000;
  const summaryCacheRef = useRef<SummaryCache>(emptySummaryCache());
  const summarizeRequestRef = useRef(0);
  const summaryHiddenUntilNewRef = useRef(false);
  const timelineItems = useMemo(
    () => (snapshot ? buildTimelineItems(snapshot.commits, snapshot.aheadCommits ?? []) : []),
    [snapshot?.commits, snapshot?.aheadCommits],
  );
  const startDiscovery = useCallback((paths: string[]) => {
    void invoke("start_repo_discovery", { savedPaths: paths }).catch(() => {
      setDiscovering(false);
    });
  }, []);

  useEffect(() => {
    void loadRepos();
    void loadAppSettings();
  }, []);

  // Network Git activity is keyed by repository, like terminal sessions. A
  // push can finish after the user has moved to another repository, so its
  // output must never bleed into the repository currently on screen.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<GitProgress>("git-progress", (event) => {
      const line = timestampLogOutput(`${event.payload.phase}: ${event.payload.message}`.trim());
      if (!line) return;
      setGitActivityByPath((current) => {
        const activity = current[event.payload.path] ?? { message: "", error: "" };
        return {
          ...current,
          [event.payload.path]: {
            ...activity,
            message: [...activity.message.split("\n"), line].filter(Boolean).slice(-120).join("\n"),
          },
        };
      });
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, []);

  const rescanDiscovery = useCallback(() => {
    startDiscovery(savedPaths);
  }, [savedPaths, startDiscovery]);

  useEffect(() => {
    if (!reposLoaded) return;

    let active = true;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const onFound = await listen<DiscoveredRepoEntry>("repo-discovery-found", (event) => {
        if (!active) return;
        setDiscoveredRepos((current) => upsertDiscoveredRepo(current, event.payload));
      });
      if (!active) {
        onFound();
        return;
      }
      unlisteners.push(onFound);

      const onStarted = await listen("repo-discovery-started", () => {
        if (!active) return;
        setDiscovering(true);
        setDiscoveredRepos([]);
      });
      if (!active) {
        onStarted();
        return;
      }
      unlisteners.push(onStarted);

      const onFinished = await listen("repo-discovery-finished", () => {
        if (active) setDiscovering(false);
      });
      if (!active) {
        onFinished();
        return;
      }
      unlisteners.push(onFinished);

      if (!discoveryStarted.current) {
        discoveryStarted.current = true;
        startDiscovery(savedPaths);
      }
    })();

    return () => {
      active = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [reposLoaded, savedPaths, startDiscovery]);

  useEffect(() => {
    setDiscoveredRepos((current) =>
      current.filter((repo) => !savedPaths.includes(repo.path)),
    );
  }, [savedPaths]);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.repo.path !== selectedPath) return;
    const first = snapshot.changes.find(isUnstaged) ?? snapshot.changes.find(isStaged);
    if (first) {
      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
      void inspectFileQuiet(first, section, snapshot.repo.path);
    }
  }, [snapshot?.repo.path, selectedPath]);

  // Compute linked-folder update status once when a repo opens (guarded against a
  // fast repo switch landing stale results). Fetch refreshes it after that.
  useEffect(() => {
    setBehindFolders([]);
    setPublishableFolders([]);
    if (!selectedPath) return;
    let cancelled = false;
    const path = selectedPath;
    void (async () => {
      // Publishable set is instant (local content comparison, no network).
      const publishable = await computePublishableFolders(path).catch(() => [] as LinkedFolder[]);
      if (!cancelled) setPublishableFolders(publishable);
      const behind = await computeBehindFolders(path).catch(() => [] as LinkedFolder[]);
      if (!cancelled) setBehindFolders(behind);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  async function run<T>(task: () => Promise<T>, successMessage = "") {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await task();
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadAppSettings() {
    try {
      const settings = await invoke<AppSettingsView>("get_app_settings");
      applyAppSettings(settings);
    } catch {
      setNvidiaApiKeyConfigured(false);
      setNvidiaApiKeyPreview(null);
      setAutoSummarizeEnabled(true);
      setFetchOnRefresh(false);
    }
  }

  function applyAppSettings(settings: AppSettingsView) {
    setNvidiaApiKeyConfigured(settings.nvidiaApiKeyConfigured);
    setNvidiaApiKeyPreview(settings.nvidiaApiKeyPreview ?? null);
    setAutoSummarizeEnabled(settings.autoSummarizeEnabled);
    setFetchOnRefresh(settings.fetchOnRefresh);
    setPushOnCommit(settings.pushOnCommit);
    const savedName = settings.backupRemoteName?.trim() || "backup";
    const savedTemplate = settings.backupUrlTemplate ?? "";
    setBackupRemoteName(savedName);
    setBackupUrlTemplate(savedTemplate);
    setSavedBackupRemoteName(savedName);
    setSavedBackupUrlTemplate(savedTemplate);
  }

  async function handlePushOnCommitChange(enabled: boolean) {
    setPushOnCommit(enabled);
    try {
      const settings = await invoke<AppSettingsView>("set_push_on_commit", { enabled });
      applyAppSettings(settings);
    } catch (err) {
      setError(String(err));
    }
  }

  async function setFetchOnRefreshSetting(enabled: boolean) {
    setFetchOnRefresh(enabled);
    try {
      const settings = await invoke<AppSettingsView>("set_fetch_on_refresh", { enabled });
      applyAppSettings(settings);
    } catch (err) {
      setError(String(err));
      void loadAppSettings();
    }
  }

  async function saveBackupProfile() {
    const remoteName = backupRemoteName.trim();
    const urlTemplate = backupUrlTemplate.trim();
    if (!remoteName || !urlTemplate) return;
    setBackupSaving(true);
    setBackupSaveMessage(null);
    setBackupSaveError(false);
    try {
      const settings = await invoke<AppSettingsView>("set_backup_profile", {
        remoteName,
        urlTemplate,
      });
      applyAppSettings(settings);
      setBackupSaveMessage("Backup default saved. Repositories will offer setup when opened.");
    } catch (err) {
      setBackupSaveMessage(String(err));
      setBackupSaveError(true);
    } finally {
      setBackupSaving(false);
    }
  }

  async function setupBackupForSelectedRepo(): Promise<boolean> {
    if (!selectedPath || !savedBackupUrlTemplate.trim()) return false;
    const path = selectedPath;
    if (backupLockRef.current.has(path)) return false;
    backupLockRef.current.add(path);
    setBackupPhases((current) => ({ ...current, [path]: "pushing" }));
    setGitActivityByPath((current) => ({ ...current, [path]: { message: timestampLogOutput("Setting up backup…"), error: "" } }));
    try {
      const result = await invoke<BackupSetupResult>("configure_backup_remote", {
        path,
        remoteName: savedBackupRemoteName,
        urlTemplate: savedBackupUrlTemplate,
      });
      if (result.synced) {
        // A completed initial sync establishes the backup as trustworthy, so
        // turn on the normal push companion without making the user opt in
        // again in repository settings.
        await invoke("set_backup_on_push", { path, enabled: true });
      }
      setGitActivityByPath((current) => {
        const activity = current[path] ?? { message: "", error: "" };
        return { ...current, [path]: { message: [activity.message, timestampLogOutput([result.message, result.output].filter(Boolean).join("\n"))].filter(Boolean).join("\n"), error: "" } };
      });
      await refreshRepoQuiet(path);
      if (result.synced) {
        setBackupPhases((current) => ({ ...current, [path]: "done" }));
        const previousTimer = backupDoneTimerRef.current.get(path);
        if (previousTimer !== undefined) window.clearTimeout(previousTimer);
        const timer = window.setTimeout(() => {
          setBackupPhases((current) => ({ ...current, [path]: "idle" }));
          backupDoneTimerRef.current.delete(path);
        }, 1600);
        backupDoneTimerRef.current.set(path, timer);
      } else {
        setBackupPhases((current) => ({ ...current, [path]: "idle" }));
      }
      return result.synced;
    } catch (err) {
      setGitActivityByPath((current) => ({ ...current, [path]: { ...(current[path] ?? { message: "", error: "" }), error: timestampLogOutput(String(err)) } }));
      setBackupPhases((current) => ({ ...current, [path]: "idle" }));
      return false;
    } finally {
      backupLockRef.current.delete(path);
    }
  }

  async function setBackupAfterPush(enabled: boolean): Promise<boolean> {
    const path = selectedPath;
    if (!path) return false;
    try {
      await invoke("set_backup_on_push", { path, enabled });
      await refreshRepoQuiet(path);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }

  function openRepoSettings() {
    setRepoSettingsOpen(true);
  }

  useEffect(() => {
    if (settingsOpen) {
      void loadAppSettings();
      setNvidiaKeyTestMessage(null);
      setNvidiaKeyTestError(false);
    }
  }, [settingsOpen]);

  async function saveNvidiaApiKeyFromPanel() {
    setChangeSummaryError(null);
    try {
      const settings = await invoke<AppSettingsView>("set_nvidia_api_key", {
        apiKey: nvidiaApiKey,
      });
      applyAppSettings(settings);
      setNvidiaApiKey("");
      summaryCacheRef.current = emptySummaryCache();
      setChangeSummary(null);
      setChangeSummaryScope("staged");
      if (settings.nvidiaApiKeyConfigured) {
        setChangeSummaryVisible(true);
        void summarizeChanges("staged", true);
      }
    } catch (err) {
      setChangeSummaryError(String(err));
    }
  }

  async function saveNvidiaApiKeyFromSettings() {
    setNvidiaKeyTestMessage(null);
    setNvidiaKeyTestError(false);
    try {
      const settings = await invoke<AppSettingsView>("set_nvidia_api_key", {
        apiKey: settingsNvidiaKey,
      });
      applyAppSettings(settings);
      setSettingsNvidiaKey("");
      resetSummaryCache();
      setNvidiaKeyTestMessage("API key saved.");
      setNvidiaKeyTestError(false);
    } catch (err) {
      setNvidiaKeyTestMessage(String(err));
      setNvidiaKeyTestError(true);
    }
  }

  async function deleteNvidiaApiKey() {
    if (!window.confirm("Remove your saved NVIDIA API key?")) return;
    setNvidiaKeyTestMessage(null);
    setNvidiaKeyTestError(false);
    try {
      const settings = await invoke<AppSettingsView>("delete_nvidia_api_key");
      applyAppSettings(settings);
      setSettingsNvidiaKey("");
      setNvidiaApiKey("");
      resetSummaryCache();
      setChangeSummaryVisible(false);
      setNvidiaKeyTestMessage("API key deleted.");
      setNvidiaKeyTestError(false);
    } catch (err) {
      setNvidiaKeyTestMessage(String(err));
      setNvidiaKeyTestError(true);
    }
  }

  async function testNvidiaApiKey() {
    setNvidiaKeyTesting(true);
    setNvidiaKeyTestMessage(null);
    setNvidiaKeyTestError(false);
    try {
      const draft = settingsNvidiaKey.trim();
      const result = await invoke<ActionResult>("test_nvidia_api_key", {
        apiKey: draft || null,
      });
      setNvidiaKeyTestMessage(result.message);
      setNvidiaKeyTestError(false);
    } catch (err) {
      setNvidiaKeyTestMessage(String(err));
      setNvidiaKeyTestError(true);
    } finally {
      setNvidiaKeyTesting(false);
    }
  }

  async function setAutoSummarizeEnabledSetting(enabled: boolean) {
    try {
      const settings = await invoke<AppSettingsView>("set_auto_summarize_enabled", { enabled });
      applyAppSettings(settings);
    } catch (err) {
      setError(String(err));
    }
  }

  function dismissChangeSummary() {
    summaryHiddenUntilNewRef.current = true;
    setChangeSummaryVisible(false);
  }

  async function loadRepos() {
    const result = await run(() => invoke<RepoEntry[]>("list_repos"));
    if (result) {
      setRepos(result);
      if (result.length > 0 && !selectedPath) {
        await selectRepo(sortRepos(result, repoSortMode)[0].path);
      }
    }
    setReposLoaded(true);
  }

  function updateRepoDirtyState(
    path: string,
    hasUncommittedChanges: boolean,
    lastActivityAt?: number | null,
  ) {
    setRepos((current) =>
      current.map((repo) =>
        repo.path === path
          ? { ...repo, hasUncommittedChanges, ...(lastActivityAt === undefined ? {} : { lastActivityAt }) }
          : repo,
      ),
    );
  }

  async function selectRepo(path: string): Promise<void> {
    if (path === selectedPath && contentPath === path) return;

    const requestId = ++selectRepoRequestRef.current;

    setSelectedPath(path);
    applyRepoSwitchCleanup();

    await waitForPaint();

    const result = await refreshRepoQuiet(path, {
      updateState: false,
      generation: requestId,
      lite: true,
      limit: INITIAL_COMMIT_LIMIT,
    });
    if (requestId !== selectRepoRequestRef.current) return;
    if (result) {
      setSnapshot(result);
      setSelectedPath(result.repo.path);
      updateRepoDirtyState(result.repo.path, !result.isClean, result.repo.lastActivityAt);
      void enrichRepoSnapshot(path, requestId);
      return;
    }

    setSelectedPath((current) => {
      if (requestId !== selectRepoRequestRef.current) return current;
      return contentPath || current;
    });
  }

  function applyRepoSwitchCleanup() {
    snapshotGenerationRef.current += 1;
    clearEditHistory();
    setViewingCommit(null);
    setViewingCommitMessage("");
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    setCommitMessage("");
    setAmend(false);
    resetSummaryCache();
    setChangeSummaryVisible(false);
    setNavZone("files");
    setRepoSettingsOpen(false);
    setIntegrationOp(null);
    setConflictFiles([]);
    setMessage("");
    setError("");
    // Commands may finish in the repo that launched them, but their sessions
    // are scoped to that repo and never appear in the next repository's feed.
    setDrawerSessionId(null);
    setResolvedFiles([]);
    setSelectedConflict(null);
    setConflictSides(null);
    setPushRejected(false);
  }

  async function enrichRepoSnapshot(path: string, switchGeneration: number): Promise<void> {
    try {
      const result = await invoke<RepoEnrichment>("repo_enrich", {
        path,
        aheadLimit: INITIAL_COMMIT_LIMIT,
      });
      if (switchGeneration !== selectRepoRequestRef.current) return;
      setSnapshot((prev) =>
        prev && prev.repo.path === path
          ? {
              ...prev,
              aheadCommits: result.aheadCommits,
              aheadBranch: result.aheadBranch,
              tags: result.tags,
              unpushedTags: result.unpushedTags,
            }
          : prev,
      );
    } catch (err) {
      if (switchGeneration !== selectRepoRequestRef.current) return;
      setError(String(err));
    }
  }

  async function refreshRepo(path = selectedPath): Promise<RepoSnapshot | null> {
    if (!path) return null;
    const result = await run(() =>
      invoke<RepoSnapshot>("repo_snapshot", {
        path,
        limit: INITIAL_COMMIT_LIMIT,
        lite: false,
      }),
    );
    if (result) {
      if (selectedPathRef.current === path) {
        setSnapshot(result);
      }
      updateRepoDirtyState(result.repo.path, !result.isClean, result.repo.lastActivityAt);
      return result;
    }
    return null;
  }

  async function refreshRepoQuiet(
    path = selectedPath,
    options?: { updateState?: boolean; generation?: number; lite?: boolean; limit?: number },
  ): Promise<RepoSnapshot | null> {
    if (!path) return null;
    const updateState = options?.updateState !== false;
    const stateGeneration = snapshotGenerationRef.current;
    try {
      const result = await invoke<RepoSnapshot>("repo_snapshot", {
        path,
        limit: options?.limit ?? INITIAL_COMMIT_LIMIT,
        generation: options?.generation ?? null,
        lite: options?.lite ?? false,
      });
      if (
        updateState &&
        stateGeneration === snapshotGenerationRef.current &&
        selectedPathRef.current === path
      ) {
        setSnapshot(result);
      }
      updateRepoDirtyState(result.repo.path, !result.isClean, result.repo.lastActivityAt);
      return result;
    } catch (err) {
      if (isSupersededSnapshotError(err)) return null;
      setError(String(err));
      return null;
    }
  }

  async function refreshChangesQuiet(path = selectedPath): Promise<FileChange[] | null> {
    if (!path) return null;
    const requestId = ++changesRefreshRequestRef.current;
    try {
      const result = await invoke<RepoChanges>("repo_changes", { path });
      // A background/focus refresh can finish after a stage or unstage refresh.
      // Ignore it rather than replacing the current index state with stale data.
      if (requestId !== changesRefreshRequestRef.current) return null;
      setSnapshot((prev) =>
        selectedPathRef.current === path && prev && prev.repo.path === path
          ? { ...prev, changes: result.changes, isClean: result.isClean }
          : prev,
      );
      updateRepoDirtyState(path, !result.isClean);
      return result.changes;
    } catch (err) {
      if (requestId !== changesRefreshRequestRef.current) return null;
      setError(String(err));
      return null;
    }
  }

  function invalidateWorkingTreeRefresh(path: string) {
    if (selectedPathRef.current !== path) return;
    snapshotGenerationRef.current += 1;
    changesRefreshRequestRef.current += 1;
  }

  async function refreshOnFocus() {
    if (workingTreeRefreshInFlightRef.current) return;
    const { selectedPath: path } = focusRefreshContextRef.current;
    if (!path) return;

    workingTreeRefreshInFlightRef.current = true;
    try {
      const focusState = await invoke<RepoFocusState>("repo_focus_state", { path }).catch(
        () => null,
      );
      if (focusRefreshContextRef.current.selectedPath !== path) return;

      const priorFingerprint = focusState
        ? focusFingerprintByPathRef.current.get(path)
        : undefined;
      if (focusState) focusFingerprintByPathRef.current.set(path, focusState.fingerprint);
      // A full snapshot is only needed when history or repository metadata
      // changed while Gitty was away. The first return to a repo establishes a
      // trustworthy baseline; later returns only pay for this when it changed.
      const shouldRefreshSnapshot =
        !!focusState &&
        (priorFingerprint === undefined || priorFingerprint !== focusState.fingerprint);
      const snapshot = shouldRefreshSnapshot ? await refreshRepoQuiet(path) : null;
      if (shouldRefreshSnapshot) {
        if (focusRefreshContextRef.current.selectedPath !== path) return;
      }

      const changes = snapshot?.changes ?? (await refreshChangesQuiet(path));
      if (!changes) return;

      const currentContext = focusRefreshContextRef.current;
      if (currentContext.selectedPath !== path || currentContext.viewingCommit) return;
      const currentFocus = currentContext.focus;
      if (currentFocus?.kind === "file" && currentFocus.section !== "commit") {
        const list =
          currentFocus.section === "unstaged"
            ? changes.filter(isUnstaged)
            : changes.filter(isStaged);
        const match = list.find((file) => file.path === currentFocus.file.path);
        if (match) {
          await inspectFileQuiet(match, currentFocus.section, path);
        } else if (list.length > 0) {
          await inspectFileQuiet(list[0], currentFocus.section, path);
        } else {
          setFocus(null);
          setDiff(emptyDiff);
        }
      }
    } finally {
      workingTreeRefreshInFlightRef.current = false;
    }
  }

  const refreshOnFocusRef = useRef(refreshOnFocus);
  refreshOnFocusRef.current = refreshOnFocus;

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused || !active) return;
        const { selectedPath } = focusRefreshContextRef.current;
        if (!selectedPath) return;
        void autoFetchRepoRef.current(selectedPath);
        if (Date.now() - lastFocusRefreshAtRef.current < FOCUS_REFRESH_MIN_INTERVAL_MS) {
          return;
        }
        if (focusRefreshTimerRef.current !== null) {
          window.clearTimeout(focusRefreshTimerRef.current);
        }
        focusRefreshTimerRef.current = window.setTimeout(() => {
          focusRefreshTimerRef.current = null;
          lastFocusRefreshAtRef.current = Date.now();
          void refreshOnFocusRef.current();
        }, FOCUS_REFRESH_DEBOUNCE_MS);
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      });

    return () => {
      active = false;
      if (focusRefreshTimerRef.current !== null) {
        window.clearTimeout(focusRefreshTimerRef.current);
        focusRefreshTimerRef.current = null;
      }
      unlisten?.();
    };
  }, []);

  async function selectAfterToggle(anchor: SelectionAnchor, changes?: FileChange[]) {
    const list =
      changes ??
      (await refreshChangesQuiet()) ??
      snapshot?.changes ??
      [];

    const sectionList =
      anchor.section === "unstaged"
        ? list.filter(isUnstaged)
        : list.filter(isStaged);

    if (sectionList.length === 0) {
      setFocus(null);
      setDiff(emptyDiff);
      return;
    }

    const index = Math.min(anchor.index, sectionList.length - 1);
    await inspectFileQuiet(sectionList[index], anchor.section);
  }

  function refreshSelectionEntries(
    prior: ChangeSelectionEntry[],
    changes: FileChange[],
  ): ChangeSelectionEntry[] {
    const refreshed: ChangeSelectionEntry[] = [];
    for (const entry of prior) {
      const unstaged = changes.find((file) => file.path === entry.file.path && isUnstaged(file));
      const staged = changes.find((file) => file.path === entry.file.path && isStaged(file));
      if (entry.section === "staged" && staged) {
        refreshed.push({ file: staged, section: "staged" });
      } else if (entry.section === "unstaged" && unstaged) {
        refreshed.push({ file: unstaged, section: "unstaged" });
      } else if (unstaged) {
        refreshed.push({ file: unstaged, section: "unstaged" });
      } else if (staged) {
        refreshed.push({ file: staged, section: "staged" });
      }
    }
    return refreshed;
  }

  function selectionPathsKey(selection: ChangeSelectionEntry[]) {
    return selection
      .map((entry) => `${entry.section}:${entry.file.path}`)
      .sort()
      .join("|");
  }

  function focusAfterToggle(
    toggledPaths: Set<string>,
    remaining: ChangeSelectionEntry[],
  ) {
    if (remaining.length === 0) return;
    if (focus?.kind !== "file" || !toggledPaths.has(focus.file.path)) return;
    const next = remaining[remaining.length - 1];
    setFocus({ kind: "file", file: next.file, section: next.section });
  }

  async function resolveSelectionAfterToggle(
    files: string[],
    changes: FileChange[],
    anchor: SelectionAnchor,
    selectionAlreadyUpdated: boolean,
  ) {
    const toggledPaths = new Set(files);
    const baseRemaining =
      anchor.remainingSelection ??
      diffSelection.filter((entry) => !toggledPaths.has(entry.file.path));
    const newSelection = refreshSelectionEntries(baseRemaining, changes);

    if (newSelection.length === 0) {
      await selectAfterToggle(anchor, changes);
      return;
    }

    focusAfterToggle(toggledPaths, newSelection);
    setDiffSelection(newSelection);

    if (selectionAlreadyUpdated) return;

    const primary =
      (focus?.kind === "file" && !toggledPaths.has(focus.file.path)
        ? newSelection.find((entry) => entry.file.path === focus.file.path)
        : undefined) ?? newSelection[newSelection.length - 1];
    setFocus({ kind: "file", file: primary.file, section: primary.section });
    await loadDiffForSelectionQuiet(newSelection);
  }

  async function addRepo(path: string) {
    const result = await run(() => invoke<RepoEntry[]>("add_repo", { path }));
    if (result) {
      setRepos(result);
      setDiscoveredRepos((current) => current.filter((repo) => repo.path !== path));
      const repo = result.find((item) => item.path === path) ?? result[result.length - 1];
      if (repo) await selectRepo(repo.path);
    }
  }

  async function saveDiscoveredRepo(path: string) {
    await addRepo(path);
  }

  async function chooseRepoFolder() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose a Git repository",
    });
    if (typeof folder === "string") await addRepo(folder);
  }

  async function inspectCommit(commit: CommitEntry, path = selectedPath) {
    const generation = ++commitInspectRef.current;
    const current = () => generation === commitInspectRef.current;

    setViewingCommit(commit);
    const files = await run(() =>
      invoke<FileChange[]>("commit_files_command", { path, commit: commit.hash }),
    );
    if (files === null || !current()) return;

    setCommitFiles(files);
    if (files.length === 0) {
      setFocus(null);
      const result = await run(() =>
        invoke<string>("commit_diff", { path, commit: commit.hash }),
      );
      if (result !== null && current()) setDiff(result || "This commit has no patch output.");
      return;
    }

    await inspectCommitFile(files[0], commit, path, generation);
  }

  async function inspectCommitFile(
    file: FileChange,
    commit: CommitEntry = viewingCommit!,
    path = selectedPath,
    /// Passed through from inspectCommit so a diff that arrives after the user
    /// has left the preview is discarded rather than drawn over the working
    /// tree. Callers that start here take the current generation.
    generation = commitInspectRef.current,
  ) {
    setFocus({ kind: "file", file, section: "commit" });
    const result = await run(() =>
      invoke<string>("file_diff", { path, filePath: file.path, commit: commit.hash }),
    );
    if (result !== null && generation === commitInspectRef.current) {
      setDiff(result || "This file has no patch in this commit.");
    }
  }

  async function selectWorkingTree(options?: {
    snapshot?: RepoSnapshot | null;
    refresh?: boolean;
  }) {
    // Any commit inspection still in flight belongs to the view we are leaving.
    // Without this its files and diff arrive after the clear and put the commit
    // back on screen, which reads as "Back to now" spinning and doing nothing.
    commitInspectRef.current += 1;
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);

    let snap = options?.snapshot ?? null;
    if (options?.refresh || !snap || snap.repo.path !== selectedPath) {
      snap = await refreshRepoQuiet(selectedPath);
    } else {
      void refreshChangesQuiet(selectedPath);
    }
    if (!snap) return;

    const first = snap.changes.find(isUnstaged) ?? snap.changes.find(isStaged);
    if (first) {
      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
      await inspectFileQuiet(first, section);
    }
  }

  async function loadDiffForSelectionQuiet(
    selection: ChangeSelectionEntry[],
    path = selectedPath,
  ) {
    const seen = new Set<string>();
    const entries = selection.filter((entry) => {
      if (seen.has(entry.file.path)) return false;
      seen.add(entry.file.path);
      return true;
    });

    const requestId = ++loadDiffRequestRef.current;
    setDiffSelection(selection);

    if (!path || entries.length === 0) {
      if (requestId !== loadDiffRequestRef.current) return;
      setDiff(emptyDiff);
      setDiffBundles([]);
      return;
    }

    try {
      const parts = await Promise.all(
        entries.map((entry) =>
          invoke<{ staged: string; unstaged: string }>("file_diff_parts", {
            path,
            filePath: entry.file.path,
          }),
        ),
      );
      if (requestId !== loadDiffRequestRef.current) return;
      const bundles = parts.flatMap((part) => buildDiffBundles(part.staged, part.unstaged));
      setDiffBundles(bundles);
      const combined = parts
        .flatMap((part) => [part.staged, part.unstaged])
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      if (entries.length === 1) {
        setDiff(combined || "This file has no tracked diff.");
      } else {
        setDiff(combined || "No diff available for selected files.");
      }
    } catch (err) {
      if (requestId !== loadDiffRequestRef.current) return;
      setError(String(err));
    }
  }

  function beginSelectionPreserve() {
    selectionPreserveRef.current += 1;
  }

  function endSelectionPreserve() {
    selectionPreserveRef.current = Math.max(0, selectionPreserveRef.current - 1);
  }

  async function reconcileWorkingSelection(path: string, affectedPaths: string[]) {
    if (selectedPathRef.current !== path) return;
    invalidateWorkingTreeRefresh(path);
    const changes = await refreshChangesQuiet(path);
    if (!changes) return;
    if (selectedPathRef.current !== path) return;

    const pathsToKeep =
      diffSelection.length > 0
        ? [...new Set(diffSelection.map((entry) => entry.file.path))]
        : focus?.kind === "file"
          ? [focus.file.path]
          : [...new Set(affectedPaths)];

    const newSelection: ChangeSelectionEntry[] = [];
    for (const path of pathsToKeep) {
      const prior = diffSelection.find((entry) => entry.file.path === path);
      const priorSection =
        prior?.section ??
        (focus?.kind === "file" && focus.file.path === path ? focus.section : undefined);
      const unstaged = changes.find((file) => file.path === path && isUnstaged(file));
      const staged = changes.find((file) => file.path === path && isStaged(file));

      if (priorSection === "staged" && staged) {
        newSelection.push({ file: staged, section: "staged" });
      } else if (priorSection === "unstaged" && unstaged) {
        newSelection.push({ file: unstaged, section: "unstaged" });
      } else if (unstaged) {
        newSelection.push({ file: unstaged, section: "unstaged" });
      } else if (staged) {
        newSelection.push({ file: staged, section: "staged" });
      }
    }

    if (newSelection.length === 0) {
      setFocus(null);
      setDiff(emptyDiff);
      setDiffSelection([]);
      return;
    }

    const primaryPath =
      affectedPaths.find((path) => pathsToKeep.includes(path)) ?? pathsToKeep[0];
    const primary =
      newSelection.find((entry) => entry.file.path === primaryPath) ??
      newSelection[newSelection.length - 1];

    setFocus({ kind: "file", file: primary.file, section: primary.section });
    setDiffSelection(newSelection);
    await loadDiffForSelectionQuiet(newSelection, path);
  }

  async function stageHunk(filePath: string, patch: string) {
    if (!selectedPath) return;
    const path = selectedPath;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("stage_hunk", { path, filePath, patch }),
      );
      if (!result) return;
      await reconcileWorkingSelection(path, [filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function unstageHunk(filePath: string, patch: string) {
    if (!selectedPath) return;
    const path = selectedPath;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("unstage_hunk", { path, filePath, patch }),
      );
      if (!result) return;
      await reconcileWorkingSelection(path, [filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function discardHunk(filePath: string, patch: string) {
    if (!selectedPath) return;
    const path = selectedPath;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("discard_hunk", { path, filePath, patch }),
      );
      if (!result) return;
      await reconcileWorkingSelection(path, [filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  function clearEditHistory() {
    editHistoryRef.current = { past: [], future: [] };
  }

  // Applies an inline single-line edit: reads the file, guards that the line we
  // edited still matches, writes just that line back, and records the change so
  // it can be undone. Re-diffs afterward so line numbers stay consistent.
  async function commitLineEdit(
    filePath: string,
    newLine: number,
    expected: string,
    text: string,
  ) {
    if (!selectedPath || text === expected) return;
    const path = selectedPath;
    beginSelectionPreserve();
    try {
      const before = await run(() =>
        invoke<string>("read_working_file", { path, filePath }),
      );
      if (before == null) return;
      if (selectedPathRef.current !== path) return;
      if (getLine(before, newLine) !== expected) {
        setError("This file changed on disk — refreshed without saving your edit.");
        await reconcileWorkingSelection(path, [filePath]);
        return;
      }
      let after: string;
      try {
        after = replaceLine(before, newLine, text);
      } catch (err) {
        setError(String(err));
        return;
      }
      const result = await run(() =>
        invoke<ActionResult>("write_working_file", {
          path,
          filePath,
          content: after,
        }),
      );
      if (!result) return;
      if (selectedPathRef.current !== path) return;
      editHistoryRef.current.past.push({ filePath, before, after });
      editHistoryRef.current.future = [];
      await reconcileWorkingSelection(path, [filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function undoEdit() {
    if (!selectedPath) return;
    const path = selectedPath;
    const entry = editHistoryRef.current.past.pop();
    if (!entry) return;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("write_working_file", {
          path,
          filePath: entry.filePath,
          content: entry.before,
        }),
      );
      if (!result) {
        editHistoryRef.current.past.push(entry);
        return;
      }
      if (selectedPathRef.current !== path) return;
      editHistoryRef.current.future.push(entry);
      await reconcileWorkingSelection(path, [entry.filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function redoEdit() {
    if (!selectedPath) return;
    const path = selectedPath;
    const entry = editHistoryRef.current.future.pop();
    if (!entry) return;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("write_working_file", {
          path,
          filePath: entry.filePath,
          content: entry.after,
        }),
      );
      if (!result) {
        editHistoryRef.current.future.push(entry);
        return;
      }
      if (selectedPathRef.current !== path) return;
      editHistoryRef.current.past.push(entry);
      await reconcileWorkingSelection(path, [entry.filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function inspectFile(file: FileChange, section: ChangeSection) {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus({ kind: "file", file, section });
  }

  async function inspectFileQuiet(file: FileChange, section: ChangeSection, path = selectedPath) {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus({ kind: "file", file, section });
    await loadDiffForSelectionQuiet([{ file, section }], path);
  }

  const handleChangesSelectionChange = useCallback(
    (selection: ChangeSelectionEntry[]) => {
      if (viewingCommit) return;
      if (selection.length === 0 && selectionPreserveRef.current > 0) return;
      const nextKey = selectionPathsKey(selection);
      const currentKey = selectionPathsKey(diffSelection);
      if (nextKey === currentKey) return;
      void loadDiffForSelectionQuiet(selection);
    },
    [selectedPath, viewingCommit, diffSelection],
  );

  // Open an old commit's files in a throwaway worktree and reveal the folder —
  // no detached HEAD, no stash, nothing to undo. Your checkout is untouched.
  async function openCommitInFolder(commit?: CommitEntry) {
    const target = commit ?? viewingCommit;
    if (!selectedPath) return;

    // No commit in view, so this is simply "show me this repository on disk".
    // The action used to appear only while previewing a commit, which meant the
    // one thing every repository can always do was hidden except in a mode you
    // had to enter first.
    if (!target) {
      try {
        await openPath(selectedPath);
      } catch (err) {
        setError(String(err));
      }
      return;
    }

    const dir = await run(() =>
      invoke<string>("open_commit_worktree", { path: selectedPath, commit: target.hash }),
    );
    if (!dir) return;
    try {
      await openPath(dir);
    } catch (err) {
      setError(String(err));
      return;
    }
    setMessage(`Opened ${target.shortHash} in a folder.`);
  }

  async function checkoutBranch(branch: string) {
    if (!selectedPath || !branch) return;

    // Picking a remote-tracking branch (e.g. "github/main") with a plain
    // checkout detaches HEAD. If a local branch already tracks it — or shares
    // its leaf name — switch to that local branch instead so the user stays on
    // a real branch they can commit and push from.
    const branches = snapshot?.branches ?? [];
    const picked = branches.find((b) => b.name === branch);
    if (picked?.isRemote) {
      const leaf = branch.split("/").slice(1).join("/");
      const localEquivalent =
        branches.find((b) => !b.isRemote && b.upstream === branch) ??
        branches.find((b) => !b.isRemote && b.name === leaf);
      if (localEquivalent) branch = localEquivalent.name;
    }

    const isDetached = snapshot?.branch.includes("detached");
    if (!isDetached && branch === snapshot?.branch) return;
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch }),
    );
    if (result) {
      setMessage(result.message);
      setViewingCommit(null);
      setCommitFiles([]);
      setFocus(null);
      setDiff(emptyDiff);
      await refreshRepo();
    }
  }

  async function createBranch(name: string) {
    if (!selectedPath || !name.trim()) return;
    const startPoint = branchFromCommit?.hash;
    const result = await run(() =>
      invoke<ActionResult>("create_branch", { path: selectedPath, name, startPoint }),
    );
    if (!result) return;
    setBranchCreateOpen(false);
    setBranchFromCommit(null);
    setMessage(result.message);
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    await refreshRepo();
  }

  // ── Integrate with main (update / merge) ────────────────────────────────

  // Where conflict resolution happens: a merge resolves inside the trunk
  // worktree; an update (rebase) resolves in the main checkout.
  const conflictPath = integrationOp?.worktree ?? selectedPath;

  function clearIntegration() {
    setIntegrationOp(null);
    setConflictFiles([]);
    setResolvedFiles([]);
    setSelectedConflict(null);
    setConflictSides(null);
  }

  // Move the conflicted-file list into a fresh op, selecting the first file.
  function enterConflicts(op: IntegrationOp, files: string[]) {
    setConflictFiles(files);
    setResolvedFiles([]);
    setSelectedConflict(files[0] ?? null);
    setIntegrationOp(op);
  }

  async function dismissIntegration() {
    clearIntegration();
    const snap = await refreshRepo();
    if (snap) await selectWorkingTree({ snapshot: snap });
  }

  // Bring main's new commits under your branch by rebasing onto it.
  async function updateFromMain() {
    if (!selectedPath || !snapshot || integrationRunning) return;
    if (!integrationBranch || onIntegrationBranch) return;
    const branch = snapshot.branch;
    setIntegrationRunning(true);
    setError("");
    setMessage("Pushing…");
    try {
      const outcome = await invoke<UpdateOutcome>("update_branch", {
        path: selectedPath,
        onto: integrationBranch,
      });
      if (outcome.status === "conflicts") {
        await refreshRepoQuiet(selectedPath);
        enterConflicts({ kind: "update", onto: integrationBranch, branch, phase: "conflicts" }, outcome.conflictFiles);
      } else {
        setMessage(outcome.message);
        await dismissIntegration();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIntegrationRunning(false);
    }
  }

  // Ship your branch into main, merging inside a hidden worktree so you never
  // leave your branch.
  async function mergeIntoMain() {
    if (!selectedPath || !snapshot || integrationRunning) return;
    if (!integrationBranch || onIntegrationBranch) return;
    const branch = snapshot.branch;
    setIntegrationRunning(true);
    setError("");
    setMessage("");
    try {
      const outcome = await invoke<MergeOutcome>("merge_into_trunk", {
        path: selectedPath,
        source: branch,
      });
      if (outcome.status === "conflicts") {
        await refreshRepoQuiet(selectedPath);
        enterConflicts(
          { kind: "merge", onto: integrationBranch, branch, worktree: outcome.worktree ?? undefined, phase: "conflicts" },
          outcome.conflictFiles,
        );
      } else {
        setMessage(outcome.message);
        setIntegrationOp({
          kind: "merge",
          onto: integrationBranch,
          branch,
          phase: "done",
          pushable: hasRemotes,
        });
        await refreshRepoQuiet(selectedPath);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIntegrationRunning(false);
    }
  }

  // Pull a linked folder from its source. On conflicts, hand off to the shared
  // resolver (a subtree pull is a merge, so it completes/aborts like one).
  async function runLinkedFolderUpdate(prefix: string) {
    if (!selectedPath || integrationRunning) return;
    setIntegrationRunning(true);
    setError("");
    setMessage("");
    try {
      const outcome = await invoke<UpdateOutcome>("update_linked_folder", {
        path: selectedPath,
        prefix,
      });
      if (outcome.status === "conflicts") {
        setRepoSettingsOpen(false);
        await refreshRepoQuiet(selectedPath);
        enterConflicts(
          { kind: "subtree", onto: "your work", branch: `${prefix} source`, prefix, phase: "conflicts" },
          outcome.conflictFiles,
        );
      } else {
        setMessage(outcome.message);
        await refreshRepoQuiet(selectedPath);
      }
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setIntegrationRunning(false);
    }
  }

  // Which linked folders are behind their source. Local list first (instant,
  // offline) — most repos have none, so we skip the network entirely. Only when
  // there are known-source folders do we spend the on-demand `ls-remote` check.
  // Best-effort: an offline/unreachable source leaves the folder out, not errors.
  async function computeBehindFolders(path: string): Promise<LinkedFolder[]> {
    const folders = await listLinkedFolders(path);
    if (!folders.some((folder) => folder.knownSource)) return [];
    const statuses = await checkSubtreeUpdates(path);
    const behind = new Set(
      statuses.filter((status) => status.updatesAvailable === true).map((status) => status.prefix),
    );
    return folders.filter((folder) => behind.has(folder.prefix));
  }

  async function refreshBehindFolders(path: string) {
    try {
      setBehindFolders(await computeBehindFolders(path));
    } catch {
      // Awareness is a convenience, not a gate — leave the last known chip state.
    }
  }

  // Which linked folders have local content to publish. Content comparison
  // (folder tree vs the source's last-fetched tip), so it clears once the source
  // has the changes — unlike the split-SHA trailer, which push leaves stale.
  async function computePublishableFolders(path: string): Promise<LinkedFolder[]> {
    const folders = await listLinkedFolders(path);
    if (!folders.some((folder) => folder.knownSource)) return [];
    const statuses = await checkSubtreePublishable(path);
    const publishable = new Set(
      statuses.filter((status) => status.publishable === true).map((status) => status.prefix),
    );
    return folders.filter((folder) => publishable.has(folder.prefix));
  }

  // Chip-triggered Update: reuse the drawer's update path (so a conflict routes
  // into the same resolver), then recompute the chip.
  async function updateLinkedFolderFromChip(prefix: string) {
    if (!selectedPath) return;
    setLinkedBusyPrefix(prefix);
    try {
      await runLinkedFolderUpdate(prefix);
      await refreshBehindFolders(selectedPath);
      await refreshPublishableFolders(selectedPath);
    } catch {
      // runLinkedFolderUpdate already surfaced the error.
    } finally {
      setLinkedBusyPrefix(null);
    }
  }

  async function refreshPublishableFolders(path: string) {
    try {
      setPublishableFolders(await computePublishableFolders(path));
    } catch {
      // Best-effort — leave the last known set in place.
    }
  }

  // Chip-triggered Publish: subtree-push a folder's committed changes to its
  // source. No conflict path (a push either lands or is rejected). Guardrails
  // (uncommitted edits, non-fast-forward) come back as thrown error strings.
  async function publishLinkedFolderFromChip(prefix: string) {
    if (!selectedPath) return;
    setLinkedPushBusyPrefix(prefix);
    setError("");
    setMessage("");
    try {
      const result = await pushLinkedFolder(selectedPath, prefix);
      setMessage(result.message);
      await refreshBehindFolders(selectedPath);
      await refreshPublishableFolders(selectedPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setLinkedPushBusyPrefix(null);
    }
  }

  // Re-read which files still conflict, from the right place for this op.
  async function refreshConflictStatus() {
    if (!integrationOp) return;
    try {
      const status =
        integrationOp.kind === "update"
          ? await invoke<UpdateStatus>("update_status", { path: selectedPath })
          : await invoke<MergeStatus>("merge_status", { path: conflictPath });
      setConflictFiles(status.conflictFiles);
      setResolvedFiles(status.resolvedFiles);
      setSelectedConflict((prev) =>
        prev && status.conflictFiles.includes(prev) ? prev : status.conflictFiles[0] ?? null,
      );
    } catch (err) {
      setError(String(err));
    }
  }

  async function resolveConflictFile(file: string, side: "ours" | "theirs") {
    const result = await run(() =>
      invoke<ActionResult>("resolve_conflict", { path: conflictPath, file, side }),
    );
    if (!result) return;
    await refreshConflictStatus();
  }

  async function resolveConflictManual(content: string) {
    if (!selectedConflict) return;
    const result = await run(() =>
      invoke<ActionResult>("resolve_conflict_manual", {
        path: conflictPath,
        file: selectedConflict,
        content,
      }),
    );
    if (!result) return;
    await refreshConflictStatus();
  }

  // Finish resolving: commit the merge, or continue the rebase (which may pause
  // again on the next conflicting commit).
  async function completeIntegration() {
    if (!integrationOp || conflictFiles.length > 0) return;
    if (integrationOp.kind === "update") {
      const outcome = await run(() =>
        invoke<UpdateOutcome>("update_continue", { path: selectedPath }),
      );
      if (!outcome) return;
      if (outcome.status === "conflicts") {
        await refreshRepoQuiet(selectedPath);
        setConflictFiles(outcome.conflictFiles);
        setResolvedFiles([]);
        setSelectedConflict(outcome.conflictFiles[0] ?? null);
      } else {
        setMessage(outcome.message);
        await dismissIntegration();
      }
    } else {
      // A merge or a subtree pull both finish by committing the merge.
      const result = await run(() =>
        invoke<ActionResult>("complete_merge", { path: conflictPath, message: null }),
      );
      if (!result) return;
      if (integrationOp.kind === "subtree") {
        setMessage(`Updated ${integrationOp.prefix}.`);
        await dismissIntegration();
      } else {
        setMessage(result.message);
        setIntegrationOp((prev) =>
          prev ? { ...prev, phase: "done", pushable: hasRemotes } : prev,
        );
        await refreshRepoQuiet(selectedPath);
      }
    }
  }

  async function cancelIntegration() {
    if (!integrationOp) return;
    // A subtree pull is a merge; only a branch update is a rebase.
    const command = integrationOp.kind === "update" ? "update_abort" : "abort_merge";
    const args =
      integrationOp.kind === "update"
        ? { path: selectedPath }
        : { path: conflictPath, returnBranch: null };
    const result = await run(() => invoke<ActionResult>(command, args));
    if (result) setMessage(result.message);
    await dismissIntegration();
  }

  // Push main after a successful merge-into-trunk, without switching onto it.
  async function pushMainAfterMerge() {
    if (!integrationOp) return;
    const result = await run(() =>
      invoke<ActionResult>("push_branch", {
        path: selectedPath,
        branch: integrationOp.onto,
        force: false,
      }),
    );
    if (!result) return;
    setMessage(result.message);
    await dismissIntegration();
  }

  async function loadConflictSides(file: string) {
    setConflictSidesLoading(true);
    try {
      const sides = await invoke<ConflictSides>("conflict_sides", {
        path: conflictPath,
        file,
      });
      setConflictSides(sides);
    } catch (err) {
      setError(String(err));
    } finally {
      setConflictSidesLoading(false);
    }
  }

  useEffect(() => {
    if (integrationOp?.phase === "conflicts" && selectedConflict) {
      void loadConflictSides(selectedConflict);
    } else {
      setConflictSides(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConflict, integrationOp?.phase, conflictPath]);

  // ⌘↵ finishes the integration once every conflict is resolved.
  useEffect(() => {
    if (integrationOp?.phase !== "conflicts") return;
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter" || event.shiftKey || event.altKey) {
        return;
      }
      if (conflictFiles.length > 0) return;
      event.preventDefault();
      void completeIntegration();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationOp?.phase, conflictFiles.length]);

  function openCreateTagDialog(commit: CommitEntry) {
    setTagCreateCommit(commit);
  }

  async function submitCreateTag(name: string) {
    if (!selectedPath || !tagCreateCommit) return;
    const commit = tagCreateCommit;
    const result = await run(() =>
      invoke<ActionResult>("create_tag", {
        path: selectedPath,
        name,
        commit: commit.hash,
      }),
    );
    if (result) {
      setMessage(result.message);
      setTagCreateCommit(null);
      await refreshRepo();
    }
  }

  function openDeleteTagDialog(commit: CommitEntry, name: string) {
    setTagDeleteTarget({ commit, name });
  }

  async function submitDeleteTag() {
    if (!selectedPath || !tagDeleteTarget) return;
    const { name } = tagDeleteTarget;
    const result = await run(() =>
      invoke<ActionResult>("delete_tag", { path: selectedPath, name }),
    );
    if (result) {
      setMessage(result.message);
      setTagDeleteTarget(null);
      await refreshRepo();
    }
  }

  async function stageAll() {
    if (!selectedPath) return;
    const path = selectedPath;
    setLoading(true);
    setError("");
    try {
      await invoke<ActionResult>("stage_all", {
        path,
        stage: true,
      });
      invalidateWorkingTreeRefresh(path);
    } catch (err) {
      if (selectedPathRef.current === path) setError(String(err));
    } finally {
      setLoading(false);
      if (selectedPathRef.current === path) await refreshChangesQuiet(path);
    }
  }

  async function unstageAll() {
    if (!selectedPath) return;
    const path = selectedPath;
    setLoading(true);
    setError("");
    try {
      await invoke<ActionResult>("stage_all", {
        path,
        stage: false,
      });
      invalidateWorkingTreeRefresh(path);
    } catch (err) {
      if (selectedPathRef.current === path) setError(String(err));
    } finally {
      setLoading(false);
      if (selectedPathRef.current === path) await refreshChangesQuiet(path);
    }
  }

  async function stageFiles(files: string[], anchor?: SelectionAnchor) {
    if (!selectedPath || files.length === 0) return;
    const path = selectedPath;

    const toggledPaths = new Set(files);
    const selectionAlreadyUpdated = anchor?.remainingSelection !== undefined;
    if (selectionAlreadyUpdated) {
      focusAfterToggle(toggledPaths, anchor.remainingSelection ?? []);
    }

    setLoading(true);
    setError("");
    try {
      await invoke<ActionResult>("stage_files", {
        path,
        files,
        stage: true,
      });
      invalidateWorkingTreeRefresh(path);
    } catch (err) {
      if (selectedPathRef.current === path) setError(String(err));
    } finally {
      setLoading(false);
    }

    if (selectedPathRef.current !== path) return;
    const changes = await refreshChangesQuiet(path);
    if (!changes) return;
    if (selectedPathRef.current !== path) return;

    if (anchor) {
      await resolveSelectionAfterToggle(files, changes, anchor, selectionAlreadyUpdated);
      return;
    }

    if (focus?.kind === "file" && files.includes(focus.file.path)) {
      const staged = changes.find((file) => file.path === focus.file.path && isStaged(file));
      if (staged) {
        await inspectFileQuiet(staged, "staged");
      }
    }
  }

  async function unstageFiles(files: string[], anchor?: SelectionAnchor) {
    if (!selectedPath || files.length === 0) return;
    const path = selectedPath;

    const toggledPaths = new Set(files);
    const selectionAlreadyUpdated = anchor?.remainingSelection !== undefined;
    if (selectionAlreadyUpdated) {
      focusAfterToggle(toggledPaths, anchor.remainingSelection ?? []);
    }

    setLoading(true);
    setError("");
    try {
      await invoke<ActionResult>("stage_files", {
        path,
        files,
        stage: false,
      });
      invalidateWorkingTreeRefresh(path);
    } catch (err) {
      if (selectedPathRef.current === path) setError(String(err));
    } finally {
      setLoading(false);
    }

    if (selectedPathRef.current !== path) return;
    const changes = await refreshChangesQuiet(path);
    if (!changes) return;
    if (selectedPathRef.current !== path) return;

    if (anchor) {
      await resolveSelectionAfterToggle(files, changes, anchor, selectionAlreadyUpdated);
      return;
    }

    if (focus?.kind === "file" && files.includes(focus.file.path)) {
      const unstaged = changes.find((file) => file.path === focus.file.path && isUnstaged(file));
      if (unstaged) {
        await inspectFileQuiet(unstaged, "unstaged");
      }
    }
  }

  async function handleAmendChange(checked: boolean) {
    setAmend(checked);
    if (!checked || !selectedPath) return;
    if (commitMessage.trim()) return;

    try {
      const message = await invoke<string>("head_commit_message", { path: selectedPath });
      if (message) {
        setCommitMessage((current) => (current.trim() ? current : message));
      }
    } catch {
      // No commits yet or repo unavailable — leave message empty.
    }
  }

  async function commit(messageOverride?: string) {
    const message = (messageOverride ?? commitMessage).trim();
    if (!message) return;
    const result = await run(() =>
      invoke<ActionResult>("commit_repo", { path: selectedPath, message, amend }),
    );
    if (result) {
      setMessage(result.message);
      setCommitMessage("");
      setAmend(false);
      setChangeSummaryVisible(false);
      resetSummaryCache();
      clearEditHistory();
      const snap = await refreshRepo();
      if (pushOnCommit && snap && snap.remotes.length > 0) {
        await push(false);
      }
    }
  }

  function resetSummaryCache() {
    summaryCacheRef.current = emptySummaryCache();
    setChangeSummary(null);
    setChangeSummaryError(null);
    setChangeSummaryScope("staged");
    summaryHiddenUntilNewRef.current = false;
  }

  async function summarizeChanges(scope: SummaryScope, force = false) {
    if (!selectedPath || !snapshot) return;

    const pathsKey = changePathsKey(snapshot.changes);
    const stagedKey = stagedPathsKey(snapshot.changes);

    if (scope === "all" && !pathsKey) {
      setChangeSummary(null);
      setChangeSummaryError(null);
      return;
    }

    if (scope === "staged" && !stagedKey) {
      setChangeSummaryError("No staged changes to summarize.");
      return;
    }

    if (!nvidiaApiKeyConfigured) {
      setChangeSummary(null);
      setChangeSummaryError(null);
      return;
    }

    const cache = summaryCacheRef.current;
    const cacheKey = scope === "all" ? pathsKey : stagedKey;
    const cachedEntry = scope === "all" ? cache.all : cache.staged;

    if (!force && cachedEntry?.pathsKey === cacheKey) {
      summaryCacheRef.current = { ...cache, displayScope: scope };
      setChangeSummary(cachedEntry.summary.summary);
      setChangeSummaryScope(scope);
      setChangeSummaryError(null);
      if (!summaryHiddenUntilNewRef.current) {
        setChangeSummaryVisible(true);
      }
      return;
    }

    summaryHiddenUntilNewRef.current = false;
    setChangeSummaryVisible(true);
    const requestId = ++summarizeRequestRef.current;
    setChangeSummaryLoading(true);
    setChangeSummaryError(null);

    try {
      const result = await invoke<ChangeSummary>("summarize_changes", {
        path: selectedPath,
        scope,
      });
      if (requestId !== summarizeRequestRef.current) return;

      const entry = { pathsKey: cacheKey, summary: result };
      summaryCacheRef.current = {
        all: scope === "all" ? entry : summaryCacheRef.current.all,
        staged: scope === "staged" ? entry : summaryCacheRef.current.staged,
        displayScope: scope,
      };
      setChangeSummary(result.summary);
      setChangeSummaryScope(scope);
    } catch (err) {
      if (requestId !== summarizeRequestRef.current) return;
      setChangeSummary(null);
      setChangeSummaryError(String(err));
    } finally {
      if (requestId === summarizeRequestRef.current) {
        setChangeSummaryLoading(false);
      }
    }
  }

  async function summarizeChangesForCommit() {
    if (!autoSummarizeEnabled) return;
    await summarizeChanges("staged", false);
  }

  async function resummarizeStagedChanges() {
    summaryHiddenUntilNewRef.current = false;
    await summarizeChanges("staged", true);
  }

  async function summarizeAllChanges() {
    summaryHiddenUntilNewRef.current = false;
    await summarizeChanges("all", true);
  }

  function restoreAllChangesSummary() {
    if (!snapshot) return;
    const cache = summaryCacheRef.current;
    const pathsKey = changePathsKey(snapshot.changes);
    if (!cache.all || cache.all.pathsKey !== pathsKey) return;
    summaryCacheRef.current = { ...cache, displayScope: "all" };
    setChangeSummary(cache.all.summary.summary);
    setChangeSummaryScope("all");
    setChangeSummaryError(null);
  }

  function handleCommitMessageFocus() {
    if (!snapshot || snapshot.changes.length === 0) return;
    if (autoSummarizeEnabled && nvidiaApiKeyConfigured) {
      void summarizeChangesForCommit();
      return;
    }
    if (!nvidiaApiKeyConfigured && !summaryHiddenUntilNewRef.current) {
      setChangeSummaryVisible(true);
    }
  }

  function useChangeSummary() {
    if (!changeSummary) return;
    summaryHiddenUntilNewRef.current = true;
    setCommitMessage(changeSummary);
    setChangeSummaryVisible(false);
    commitMessageRef.current?.focus();
  }

  function useChangeSummaryAndCommit() {
    if (!changeSummary?.trim()) return;
    summaryHiddenUntilNewRef.current = true;
    setChangeSummaryVisible(false);
    void commit(changeSummary);
  }

  // ⌘↵ with staged changes but no message/summary yet: start preparing the AI
  // commit message so a second ⌘↵ can accept it. Triggered explicitly by the
  // shortcut, so it runs regardless of the auto-summarize-on-focus setting.
  function prepareCommitSummary() {
    if (!snapshot || snapshot.changes.length === 0) return;
    if (nvidiaApiKeyConfigured) {
      summaryHiddenUntilNewRef.current = false;
      void summarizeChanges("staged", false);
    } else if (!summaryHiddenUntilNewRef.current) {
      setChangeSummaryVisible(true);
    }
  }

  async function fetchRepo(path = selectedPath, { silent = false }: { silent?: boolean } = {}): Promise<boolean> {
    if (!path || fetchLockRef.current.has(path)) return false;

    fetchLockRef.current.add(path);
    setFetchingPaths((current) => ({ ...current, [path]: true }));
    if (!silent) {
      setLoading(true);
      setError("");
      setMessage("");
    }

    try {
      const result = await invoke<ActionResult>("fetch_repo", { path });
      if (!silent) setMessage(result.message);
      await refreshRepoQuiet(path);
      // Fetch is the network moment we piggyback the linked-folder checks on.
      // Do not let a fetch that finishes after a repository switch overwrite the
      // chips shown for the newly selected repository.
      if (selectedPathRef.current === path) {
        await refreshBehindFolders(path);
        await refreshPublishableFolders(path);
      }
      return true;
    } catch (err) {
      // Automatic checks are advisory: offline work should stay quiet. An
      // explicitly requested fetch still reports authentication/network errors.
      if (!silent) setError(String(err));
      return false;
    } finally {
      fetchLockRef.current.delete(path);
      setFetchingPaths((current) => {
        const { [path]: _finished, ...remaining } = current;
        return remaining;
      });
      if (!silent) setLoading(false);
    }
  }

  function autoFetchRepo(path: string) {
    if (!path || document.visibilityState === "hidden") return;
    const now = Date.now();
    const lastFetch = lastAutoFetchAtRef.current.get(path) ?? 0;
    if (now - lastFetch < AUTO_FETCH_MIN_INTERVAL_MS) return;
    lastAutoFetchAtRef.current.set(path, now);
    void fetchRepo(path, { silent: true });
  }

  autoFetchRepoRef.current = autoFetchRepo;

  // A selected remote-backed repository gets one quiet check when opened and
  // then a low-frequency update while Gitty stays in view. Returning focus also
  // goes through `autoFetchRepoRef` above, so a merge made in GitHub is picked
  // up promptly without needing to visit Repository Settings.
  useEffect(() => {
    const path = snapshot?.repo.path;
    if (!path || path !== selectedPath || snapshot.remotes.length === 0) return;
    autoFetchRepoRef.current(path);
    const timer = window.setInterval(() => autoFetchRepoRef.current(path), AUTO_FETCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [selectedPath, snapshot?.repo.path, snapshot?.remotes.length]);

  // `tags` is opt-in. Ordinary Push ships commits only; tags go out through the
  // push menu, because a fork's tags usually came from upstream and pushing
  // them republishes someone else's releases under your name.
  async function push(force: boolean, hard = false, tags = false): Promise<boolean> {
    const path = selectedPath;
    if (
      !path ||
      pushLockRef.current.has(path) ||
      backupLockRef.current.has(path) ||
      (pushPhases[path] ?? "idle") !== "idle"
    ) return false;
    if (hard) {
      if (
        !window.confirm(
          "Overwrite the remote with your local branch?\n\n" +
            "This runs `git push --force` and permanently discards any commits on the " +
            "remote that you don't have locally. Use this only when a normal force push " +
            "was rejected as “stale info” and you're sure you want your version to win.",
        )
      ) {
        return false;
      }
    } else if (force && !window.confirm("Force push with --force-with-lease?")) {
      return false;
    }

    pushLockRef.current.add(path);
    setPushPhases((current) => ({ ...current, [path]: "pushing" }));
    setGitActivityByPath((current) => ({ ...current, [path]: { message: timestampLogOutput("Pushing…"), error: "" } }));
    await waitForPaint();

    try {
      const result = await invoke<ActionResult>("push_repo", { path, force, hard, tags });
      setGitActivityByPath((current) => {
        const activity = current[path] ?? { message: "", error: "" };
        return { ...current, [path]: { message: [activity.message, timestampLogOutput([result.message, result.output].filter(Boolean).join("\n"))].filter(Boolean).join("\n"), error: "" } };
      });
      if (selectedPath === path) setPushRejected(false);
      const snap = await refreshRepoQuiet(path);
      // Only count what this push actually tried to ship. Tags left behind by a
      // commits-only push are not "remaining work" — counting them held the
      // button in its post-push state forever on any fork carrying upstream tags.
      const remaining = (snap?.ahead ?? 0) + (tags ? snap?.unpushedTags?.length ?? 0 : 0);
      if (remaining === 0) {
        const timer = pushDoneTimerRef.current.get(path);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          pushDoneTimerRef.current.delete(path);
        }
        setPushPhases((current) => ({ ...current, [path]: "idle" }));
      } else {
        setPushPhases((current) => ({ ...current, [path]: "done" }));
        const previousTimer = pushDoneTimerRef.current.get(path);
        if (previousTimer !== undefined) {
          window.clearTimeout(previousTimer);
        }
        const timer = window.setTimeout(() => {
          setPushPhases((current) => ({ ...current, [path]: "idle" }));
          pushDoneTimerRef.current.delete(path);
        }, 1600);
        pushDoneTimerRef.current.set(path, timer);
      }
      return true;
    } catch (err) {
      const errText = String(err);
      setGitActivityByPath((current) => ({ ...current, [path]: { ...(current[path] ?? { message: "", error: "" }), error: timestampLogOutput(errText) } }));
      // A non-fast-forward / stale-info rejection means the remote moved under us.
      // Surface the force-push affordances even though our cached `behind` count
      // may still be 0. (A hard `--force` already overwrites, so nothing to add.)
      if (!hard && /non-fast-forward|\[rejected\]|fetch first|stale info|failed to push some refs/i.test(errText)) {
        if (selectedPath === path) setPushRejected(true);
      }
      setPushPhases((current) => ({ ...current, [path]: "idle" }));
      await refreshRepoQuiet(path);
      return false;
    } finally {
      pushLockRef.current.delete(path);
    }
  }

  const pushRef = useRef(push);
  pushRef.current = push;

  // Bring the current branch up to date with its upstream. A purely-behind branch
  // fast-forwards; a diverged branch rebases (or merges, when `merge`), routing any
  // conflicts into the same resolver used for update-from-main.
  async function pull(merge = false): Promise<boolean> {
    if (!selectedPath || !snapshot || snapshot.repo.path !== selectedPath) return false;
    if (pullLockRef.current || pullPhase !== "idle" || integrationOp) return false;

    pullLockRef.current = true;
    setPullPhase("pulling");
    setError("");
    setMessage("");
    await waitForPaint();

    const branch = snapshot.branch;
    const upstreamRef = snapshot.upstream ?? "the remote";
    try {
      const outcome = await invoke<UpdateOutcome>("pull_repo", { path: selectedPath, merge });
      if (outcome.status === "conflicts") {
        // Rebase conflicts resolve in the main checkout (kind "update"); a merge
        // pull commits a merge (kind "merge") — both drive the shared resolver.
        setPullPhase("idle");
        await refreshRepoQuiet(selectedPath);
        enterConflicts(
          merge
            ? { kind: "merge", onto: upstreamRef, branch, phase: "conflicts" }
            : { kind: "update", onto: upstreamRef, branch, phase: "conflicts" },
          outcome.conflictFiles,
        );
        return false;
      }

      setMessage([outcome.message, outcome.output].filter(Boolean).join("\n"));
      const snap = await refreshRepoQuiet(selectedPath);
      if (snap) await selectWorkingTree({ snapshot: snap });
      if ((snap?.behind ?? 0) === 0) {
        setPullPhase("done");
        if (pullDoneTimerRef.current !== null) window.clearTimeout(pullDoneTimerRef.current);
        pullDoneTimerRef.current = window.setTimeout(() => {
          setPullPhase("idle");
          pullDoneTimerRef.current = null;
        }, 1600);
      } else {
        setPullPhase("idle");
      }
      return true;
    } catch (err) {
      setError(String(err));
      setPullPhase("idle");
      await refreshRepoQuiet(selectedPath);
      return false;
    } finally {
      pullLockRef.current = false;
    }
  }

  const stageAllRef = useRef(async () => {});
  stageAllRef.current = async () => {
    if (!selectedPath || !snapshot || snapshot.repo.path !== selectedPath) return;
    await stageAll();
  };

  async function reset() {
    if (!selectedCommit || !selectedPath) return;
    if (resetMode === "hard" && !window.confirm(`Hard reset to ${selectedCommit.shortHash}?`)) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("reset_to_commit", {
        path: selectedPath,
        commit: selectedCommit.hash,
        mode: resetMode,
      }),
    );
    if (result) {
      setMessage([result.message, result.output].filter(Boolean).join("\n"));
      await refreshRepo();
    }
  }

  // Reset straight to a right-clicked timeline node; mode comes from the dialog.
  async function resetToCommit(commit: CommitEntry, mode: "soft" | "hard") {
    if (!selectedPath) return;
    const result = await run(() =>
      invoke<ActionResult>("reset_to_commit", {
        path: selectedPath,
        commit: commit.hash,
        mode,
      }),
    );
    if (!result) return;
    setResetToTarget(null);
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    setMessage([result.message, result.output].filter(Boolean).join("\n"));
    await refreshRepo();
  }

  async function resetAllWorkingTree(includeUntracked: boolean) {
    if (!selectedPath) return;
    const result = await run(() =>
      invoke<ActionResult>("reset_working_tree", {
        path: selectedPath,
        includeUntracked,
      }),
    );
    if (!result) return;
    setResetAllOpen(false);
    setFocus(null);
    setDiff(emptyDiff);
    setChangeSummaryVisible(false);
    resetSummaryCache();
    setMessage([result.message, result.output].filter(Boolean).join("\n"));
    await refreshRepo();
  }

  async function discardSelectedFiles() {
    if (!selectedPath || discardFilesTarget.length === 0) return;
    const discardedPaths = [...discardFilesTarget];
    const result = await run(() =>
      invoke<ActionResult>("discard_files", {
        path: selectedPath,
        files: discardedPaths,
      }),
    );
    if (!result) return;
    setDiscardFilesOpen(false);
    setDiscardFilesTarget([]);
    if (
      focus?.kind === "file" &&
      discardedPaths.includes(focus.file.path)
    ) {
      setFocus(null);
      setDiff(emptyDiff);
    }
    setChangeSummaryVisible(false);
    resetSummaryCache();
    setMessage([result.message, result.output].filter(Boolean).join("\n"));
    await refreshRepo();
  }

  function openDiscardFilesDialog(paths: string[]) {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return;
    setDiscardFilesTarget(uniquePaths);
    setDiscardFilesOpen(true);
  }

  async function saveRemote(name: string, url: string): Promise<boolean> {
    const result = await run(() =>
      invoke<ActionResult>("set_remote", { path: selectedPath, name, url }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
      return true;
    }
    return false;
  }

  async function removeRemote(name: string): Promise<boolean> {
    const result = await run(() =>
      invoke<ActionResult>("remove_remote", { path: selectedPath, name }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
      return true;
    }
    return false;
  }

  async function removeRepo(path: string) {
    const repo = repos.find((item) => item.path === path);
    if (!repo) return;
    if (!window.confirm(`Remove ${repo.name} from Gitty?`)) return;
    const result = await run(() => invoke<RepoEntry[]>("remove_repo", { path }));
    if (result) {
      setRepos(result);
      setSettingsOpen(false);
      setRepoSettingsOpen(false);
      if (path === selectedPath) {
        const next = result[0];
        if (next) await selectRepo(next.path);
        else {
          setSelectedPath("");
          setSnapshot(null);
          setFocus(null);
          setDiff(emptyDiff);
        }
      }
    }
  }

  async function removeSelectedRepo() {
    if (!snapshot) return;
    await removeRepo(snapshot.repo.path);
  }

  async function reorderRepos(orderedPaths: string[]) {
    // Optimistically apply the new order so the drag feels instant.
    const byPath = new Map(repos.map((repo) => [repo.path, repo]));
    const optimistic = orderedPaths
      .map((path) => byPath.get(path))
      .filter((repo): repo is RepoEntry => repo !== undefined);
    if (optimistic.length === repos.length) setRepos(optimistic);
    const result = await run(() =>
      invoke<RepoEntry[]>("reorder_repos", { paths: orderedPaths }),
    );
    if (result) setRepos(result);
  }

  function changeRepoSortMode(mode: RepoSortMode) {
    setRepoSortMode(mode);
    try {
      localStorage.setItem(REPO_SORT_KEY, mode);
    } catch {
      // Sorting still works for this session when browser storage is unavailable.
    }
  }

  const stagedCount = snapshot?.changes.filter(isStaged).length ?? 0;
  const unstagedCount = snapshot?.changes.filter(isUnstaged).length ?? 0;
  const changeCount = snapshot?.changes.length ?? 0;
  const allPathsKey = snapshot ? changePathsKey(snapshot.changes) : "";
  const allSummaryAvailable =
    !!snapshot &&
    summaryCacheRef.current.all?.pathsKey === allPathsKey &&
    allPathsKey.length > 0;
  const hasMixedChanges = stagedCount > 0 && stagedCount < changeCount;
  const showResummarizeStaged =
    !!changeSummary && hasMixedChanges && changeSummaryScope === "all";
  const showSummarizeAllChanges =
    !!changeSummary && hasMixedChanges && changeSummaryScope === "staged" && !allSummaryAvailable;
  const canShowAllChangesSummary = changeSummaryScope === "staged" && allSummaryAvailable;

  useEffect(() => {
    if (!snapshot) return;
    const pathsKey = changePathsKey(snapshot.changes);
    const stagedKey = stagedPathsKey(snapshot.changes);
    const cache = summaryCacheRef.current;

    if (cache.all && cache.all.pathsKey !== pathsKey) {
      summaryCacheRef.current = { ...cache, all: null };
      if (cache.displayScope === "all") {
        if (cache.staged && cache.staged.pathsKey === stagedKey) {
          setChangeSummary(cache.staged.summary.summary);
          setChangeSummaryScope("staged");
          summaryCacheRef.current = { ...summaryCacheRef.current, displayScope: "staged" };
        } else {
          setChangeSummary(null);
          setChangeSummaryScope("staged");
        }
      }
    }

    if (cache.staged && cache.staged.pathsKey !== stagedKey) {
      summaryHiddenUntilNewRef.current = false;
      summaryCacheRef.current = {
        ...summaryCacheRef.current,
        staged: null,
      };
      if (summaryCacheRef.current.displayScope === "staged") {
        setChangeSummary(null);
        setChangeSummaryScope("staged");
      }
    }
  }, [snapshot?.changes, snapshot?.repo.path]);
  const hasRemotes = (snapshot?.remotes.length ?? 0) > 0;
  // Offer setup alongside Push once Settings contains a usable default and
  // this repository lacks that remote. Existing remotes are never repurposed.
  const backupSetupAvailable =
    hasRemotes &&
    savedBackupRemoteName.trim().length > 0 &&
    savedBackupUrlTemplate.trim().includes("{repo}") &&
    !snapshot?.remotes.some((remote) => remote.name === savedBackupRemoteName.trim());
  const backupAvailable =
    savedBackupRemoteName.trim().length > 0 && savedBackupUrlTemplate.trim().includes("{repo}");
  const hasBackupRemote = hasRemotes && (snapshot?.remotes.length ?? 0) > 1;
  const showCommitSection = workingTreeActive && !integrationOp;
  const showResetSection = false;

  useEffect(() => {
    if (!viewingCommit || !selectedPath) {
      setViewingCommitMessage("");
      return;
    }

    let active = true;
    void (async () => {
      try {
        const text = await invoke<string>("commit_message", {
          path: selectedPath,
          commit: viewingCommit.hash,
        });
        if (active) setViewingCommitMessage(text);
      } catch {
        if (active) setViewingCommitMessage(viewingCommit.subject);
      }
    })();

    return () => {
      active = false;
    };
  }, [viewingCommit, selectedPath]);
  const showSetupRemote = workingTreeActive && !hasRemotes;
  const showGittyEmptyState = workingTreeActive && changeCount === 0;

  useEffect(() => {
    if (!workingTreeActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (shouldIgnoreEnterShortcut(event)) return;
      event.preventDefault();
      commitMessageRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [workingTreeActive]);

  const canPush =
    hasRemotes &&
    ((snapshot?.ahead ?? 0) > 0 ||
      (snapshot?.unpushedTags?.length ?? 0) > 0 ||
      (snapshot?.branchUnpublished ?? false) ||
      (snapshot?.backupPushPending ?? false));
  const unpushedTagSet = useMemo(
    () => new Set(snapshot?.unpushedTags ?? []),
    [snapshot?.unpushedTags],
  );

  useEffect(() => {
    if (!canPush || pushPhase !== "idle") return;

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key !== "Enter") return;
      event.preventDefault();
      void pushRef.current(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPush, pushPhase]);

  useEffect(() => {
    return () => {
      pushDoneTimerRef.current.forEach((timer) => window.clearTimeout(timer));
      backupDoneTimerRef.current.forEach((timer) => window.clearTimeout(timer));
      if (messageDismissTimerRef.current !== null) {
        window.clearTimeout(messageDismissTimerRef.current);
      }
    };
  }, []);

  useShortcut("stageAll", () => void stageAllRef.current(), {
    enabled: workingTreeActive && !loading,
  });

  useShortcut("toggleSidebar", toggleSidebar);

  useShortcut("help", () => setKeyboardSheetOpen((was) => !was));

  // Undo and redo for inline line edits, not general undo. While a line's input
  // is focused the guard bails so the browser's own text undo runs; once the
  // edit is committed and focus leaves, these take over.
  //
  // Two separate bindings rather than one handler branching on Shift, so the
  // table can name them separately and the sheet can say plainly that this is
  // a line edit rather than anything that would bring a commit back.
  const lineEditsActive = workingTreeActive && !viewingCommit && !loading;
  useShortcut("undoEdit", () => void undoEdit(), { enabled: lineEditsActive });
  useShortcut("redoEdit", () => void redoEdit(), { enabled: lineEditsActive });

  useShortcut("mergeIntoMain", () => void mergeIntoMain(), {
    enabled: !!canMergeIntoMain && !integrationOp && !integrationRunning,
  });

  useEffect(() => {
    if (!snapshot) return;
    const currentSnapshot = snapshot;

    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreKeyboardNavigation(event)) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (navZone !== "timeline") return;
      // The strip isn't on screen in the graph, and navZone stays "timeline"
      // across the switch, so without this arrows kept moving a selection the
      // user could no longer see. The graph owns its own keys while it's up.
      if (historyView === "graph") return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        const currentIndex = timelineSelectionIndex(
          timelineItems,
          selectedCommit?.hash,
          workingTreeActive,
        );
        const item = moveTimelineSelection(timelineItems, currentIndex, delta);
        if (!item) return;
        if (item.kind === "working-tree") void selectWorkingTree();
        else void inspectCommit(item.commit);
        return;
      }

      setNavZone("files");
      const changes = viewingCommit ? commitFiles : currentSnapshot.changes;
      const variant = viewingCommit ? "commit" : "working";
      const entries = buildChangeEntries(changes, variant);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const entry = moveChangeSelection(entries, -1, delta);
      if (entry) {
        if (variant === "commit" && viewingCommit) {
          void inspectCommitFile(entry.file, viewingCommit);
        } else {
          void inspectFile(entry.file, entry.section);
        }
      }
      changesListRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    snapshot,
    navZone,
    historyView,
    timelineItems,
    selectedCommit?.hash,
    workingTreeActive,
    viewingCommit,
    commitFiles,
  ]);

  const visibleTerminalSessions = terminalSessions.filter(
    (session) => session.repoPath === selectedPath,
  );
  const runningExecution =
    visibleTerminalSessions.find((session) => session.status === "running") ?? null;
  const drawerExecution =
    visibleTerminalSessions.find((session) => session.runId === drawerSessionId) ?? null;

  return (
    <main className={`app-shell${sidebarVisible ? "" : " sidebar-hidden"}`}>
      <RepoSidebar
        repos={sortedRepos}
        discoveredRepos={sortedDiscoveredRepos}
        discovering={discovering}
        selectedPath={selectedPath}
        contentPath={contentPath}
        onSelect={(path) => void selectRepo(path)}
        onSaveDiscovered={(path) => void saveDiscoveredRepo(path)}
        onRemoveRepo={(path) => void removeRepo(path)}
        onReorder={(paths) => void reorderRepos(paths)}
        sortMode={repoSortMode}
        onSortModeChange={changeRepoSortMode}
        onAddExisting={() => void chooseRepoFolder()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenRepoSettings={(path) => {
          if (path !== selectedPath) {
            void selectRepo(path).then(() => openRepoSettings());
          } else {
            openRepoSettings();
          }
        }}
        onRescanDiscovery={rescanDiscovery}
        onHide={toggleSidebar}
      />

      <section className={`main-area${repoSwitching ? " repo-switching" : ""}`}>
        {!sidebarVisible && !displaySnapshot && !repoSwitching ? (
          <button
            type="button"
            className="sidebar-restore-btn"
            title="Show repositories"
            aria-label="Show repositories"
            onClick={toggleSidebar}
          >
            <PanelLeft size={15} />
          </button>
        ) : null}
        {repoSwitching ? (
          <>
            <TopBar
              repos={sortedRepos}
              selectedPath={selectedPath}
              branch="…"
              branches={["…"]}
              loading
              repoSwitching
              sidebarVisible={sidebarVisible}
              onToggleSidebar={toggleSidebar}
              onRepoChange={(path) => void selectRepo(path)}
              onBranchChange={() => {}}
              onRefresh={() => {}}
            />
            <div className="repo-loading-state" aria-busy="true" aria-live="polite">
              <RefreshCw size={28} className="spin" aria-hidden="true" />
              <p>
                Loading <strong>{switchingRepoName}</strong>…
              </p>
            </div>
          </>
        ) : displaySnapshot ? (
          <>
            <TopBar
              repos={sortedRepos}
              selectedPath={selectedPath}
              branch={displaySnapshot.branch}
              branches={branchNames.length > 0 ? branchNames : [displaySnapshot.branch]}
              worktrees={worktrees}
              loading={loading}
              fetching={fetching}
              pushPhase={pushPhase}
              pullPhase={pullPhase}
              ahead={displaySnapshot.ahead}
              behind={displaySnapshot.behind}
              unpushedTags={displaySnapshot.unpushedTags?.length ?? 0}
              hasRemotes={hasRemotes}
              hasUpstream={!!displaySnapshot.upstream}
              branchUnpublished={displaySnapshot.branchUnpublished ?? false}
              forceSuggested={pushRejected}
              sidebarVisible={sidebarVisible}
              onToggleSidebar={toggleSidebar}
              repoActions={repoActions}
              selectedRepoActionId={selectedRepoActionId}
              activeExecution={runningExecution}
              onRunAction={handleRunAction}
              onSelectRepoAction={handleSelectRepoAction}
              onRunCustomCommand={handleRunCustomCommand}
              onRepoChange={(path) => void selectRepo(path)}
              onOpenWorktree={(path) => void addRepo(path)}
              onBranchChange={(branch) => {
                // Git can't check out a branch that's open in another folder.
                // Rather than let it fail, go to that folder — which is what
                // the user meant by selecting the branch.
                const elsewhere = worktrees.find(
                  (entry) => !entry.isCurrent && entry.branch === branch,
                );
                if (elsewhere) {
                  void addRepo(elsewhere.path);
                  return;
                }
                void checkoutBranch(branch);
              }}
              viewingCommit={viewingCommit}
              onRefresh={() => void (fetchOnRefresh ? fetchRepo() : refreshRepo())}
              onPush={() => push(false)}
              onForcePush={() => push(true)}
              onOverwrite={() => push(true, true)}
              onPushTags={() => push(false, false, true)}
              disabled={backupPhase !== "idle"}
              backupSetupAvailable={backupSetupAvailable}
              backupRemoteName={savedBackupRemoteName.trim() || null}
              backupPhase={backupPhase}
              onSetupBackup={backupSetupAvailable ? setupBackupForSelectedRepo : undefined}
              onPull={() => pull(false)}
              onPullMerge={() => pull(true)}
              onSetupRemote={() => openRepoSettings()}
              linkedUpdates={behindFolders}
              linkedBusyPrefix={linkedBusyPrefix}
              onUpdateLinkedFolder={updateLinkedFolderFromChip}
              linkedPublishable={publishableFolders}
              linkedPushBusyPrefix={linkedPushBusyPrefix}
              onPublishLinkedFolder={publishLinkedFolderFromChip}
              onManageLinkedFolders={() => openRepoSettings()}
            />

            <div className="working-view">
                <HistoryTimeline
                  historyView={historyView}
                  onHistoryViewChange={setHistoryView}
                  currentBranch={displaySnapshot.branch}
                  worktrees={worktrees}
                  unpushedCommits={displaySnapshot.unpushedCommits}
                  onOpenCheckout={(path) => void addRepo(path)}
                  key={displaySnapshot.repo.path}
                  commits={displaySnapshot.commits}
                  aheadCommits={displaySnapshot.aheadCommits ?? []}
                  changeCount={displaySnapshot.changes.length}
                  unpushedTags={unpushedTagSet}
                  selectedHash={selectedCommit?.hash}
                  workingTreeActive={workingTreeActive}
                  contextLanes={displaySnapshot.timelineContext ?? []}
                  siblingTip={displaySnapshot.siblingTip}
                  onSwitchSibling={(name) => void checkoutBranch(name)}
                  canUpdateFromMain={canUpdateFromMain && !integrationOp}
                  canMergeIntoMain={canMergeIntoMain && !integrationOp}
                  integrationBusy={integrationRunning}
                  onUpdateFromMain={() => void updateFromMain()}
                  onMergeIntoMain={() => void mergeIntoMain()}
                  inPreview={!!viewingCommit}
                  onOpenVersion={() => void openCommitInFolder()}
                  onReturnToWorkingTree={() => void selectWorkingTree()}
                  onInteract={() => setNavZone("timeline")}
                  onSelect={(commit) => void inspectCommit(commit)}
                  onSelectWorkingTree={() => void selectWorkingTree()}
                  onVisitCommit={(commit) => void openCommitInFolder(commit)}
                  onCreateTag={(commit) => openCreateTagDialog(commit)}
                  onDeleteTag={(commit, name) => openDeleteTagDialog(commit, name)}
                  onBranchFrom={(commit) => {
                    setBranchFromCommit(commit);
                    setBranchCreateOpen(true);
                  }}
                  onResetTo={(commit) => setResetToTarget(commit)}
                  integrationPreview={
                    integrationOp && integrationOp.kind !== "subtree"
                      ? {
                          kind: integrationOp.kind,
                          branch: integrationOp.branch,
                          onto: integrationOp.onto,
                          done: integrationOp.phase === "done",
                          conflicts: integrationOp.phase === "conflicts",
                        }
                      : null
                  }
                />

                {integrationOp && integrationOp.phase === "conflicts" ? (
                  <div className="merge-conflict-grid">
                    <div className="conflict-file-list">
                      <header className="conflict-list-head">
                        <span>Conflicted</span>
                        <em>{conflictFiles.length}</em>
                      </header>
                      {conflictFiles.length === 0 ? (
                        <p className="conflict-list-empty">
                          All conflicts resolved. Finish{" "}
                          {integrationOp.kind === "merge" ? "the merge" : "the update"}.
                        </p>
                      ) : (
                        <ul>
                          {conflictFiles.map((file) => (
                            <li key={file}>
                              <button
                                type="button"
                                className={file === selectedConflict ? "active" : ""}
                                onClick={() => setSelectedConflict(file)}
                              >
                                <span className="conflict-file-row-name">
                                  {file.split("/").pop()}
                                </span>
                                <span className="conflict-file-row-path">{file}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {resolvedFiles.length > 0 ? (
                        <>
                          <header className="conflict-list-head resolved">
                            <span>Resolved</span>
                            <em>{resolvedFiles.length}</em>
                          </header>
                          <ul>
                            {resolvedFiles.map((file) => (
                              <li key={file} className="resolved-row">
                                <span className="conflict-file-row-name">
                                  {file.split("/").pop()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>

                    <ConflictResolver
                      file={selectedConflict}
                      sides={conflictSides}
                      loading={conflictSidesLoading}
                      oursLabel={integrationOp.onto}
                      theirsLabel={integrationOp.branch}
                      resolved={
                        !!selectedConflict && resolvedFiles.includes(selectedConflict)
                      }
                      onUseOurs={() =>
                        selectedConflict &&
                        void resolveConflictFile(selectedConflict, "ours")
                      }
                      onUseTheirs={() =>
                        selectedConflict &&
                        void resolveConflictFile(selectedConflict, "theirs")
                      }
                      onSaveManual={(content) => void resolveConflictManual(content)}
                    />

                    <aside className="integration-panel">
                      <header className="integration-panel-title">
                        {integrationOp.kind === "merge" ? (
                          <>Merge <strong>{integrationOp.branch}</strong> into <strong>{integrationOp.onto}</strong></>
                        ) : integrationOp.kind === "subtree" ? (
                          <>Update <strong>{integrationOp.prefix}</strong> from its source</>
                        ) : (
                          <>Update <strong>{integrationOp.branch}</strong> from <strong>{integrationOp.onto}</strong></>
                        )}
                      </header>
                      <p className="integration-panel-sub">
                        {conflictFiles.length > 0
                          ? `${conflictFiles.length} file${conflictFiles.length === 1 ? "" : "s"} to resolve`
                          : "All resolved — ready to finish."}
                      </p>
                      <button
                        type="button"
                        className="commit-primary"
                        disabled={conflictFiles.length > 0 || loading}
                        onClick={() => void completeIntegration()}
                      >
                        {integrationOp.kind === "merge"
                          ? "Complete merge"
                          : integrationOp.kind === "subtree"
                            ? "Finish update"
                            : "Continue update"}
                        <kbd>{SHORTCUT.commit}</kbd>
                      </button>
                      <button
                        type="button"
                        className="merge-secondary danger"
                        onClick={() => void cancelIntegration()}
                      >
                        Cancel
                      </button>
                    </aside>
                  </div>
                ) : historyView === "graph" ? (
                  <GraphView
                    commits={displaySnapshot.graphCommits ?? []}
                    headHash={displaySnapshot.commits[0]?.hash}
                    headBranch={displaySnapshot.branch}
                    selectedHash={selectedCommit?.hash}
                    unpushedTags={unpushedTagSet}
                    worktrees={worktrees}
                    onSelect={(commit) => {
                      // Picking a commit here is picking it in the app, not just
                      // in this view: land on it in the normal view, the same
                      // state as selecting it on the timeline.
                      setHistoryView("strip");
                      void inspectCommit(commit);
                    }}
                  />
                ) : showGittyEmptyState && !integrationOp ? (
                  <GittyEmptyState projectName={displaySnapshot.repo.name} />
                ) : (
                  <div className="workspace-grid">
                    <SplitPane
                      className="workspace-split"
                      orientation="horizontal"
                      split={workspaceSplit}
                      onSplitChange={setWorkspaceSplit}
                      showLayoutToggle={false}
                      minSplit={0.15}
                      maxSplit={0.65}
                      primary={
                        <ChangesList
                          ref={changesListRef}
                          changes={viewingCommit ? commitFiles : displaySnapshot.changes}
                          repoPath={selectedPath}
                          variant={viewingCommit ? "commit" : "working"}
                          selectedKey={selectedFileKey}
                          managedSelection={workingTreeActive ? diffSelection : undefined}
                          onFocusZone={() => setNavZone("files")}
                          onExitToTimeline={
                            viewingCommit ? () => setNavZone("timeline") : undefined
                          }
                          onSelect={(file, section) => {
                            if (section === "commit" && viewingCommit) {
                              void inspectCommitFile(file, viewingCommit);
                            } else {
                              void inspectFile(file, section);
                            }
                          }}
                          onSelectionChange={
                            workingTreeActive ? handleChangesSelectionChange : undefined
                          }
                          onStage={(files, anchor) => void stageFiles(files, anchor)}
                          onUnstage={(files, anchor) => void unstageFiles(files, anchor)}
                          onStageAll={workingTreeActive ? () => void stageAll() : undefined}
                          onUnstageAll={workingTreeActive ? () => void unstageAll() : undefined}
                          onResetAll={
                            workingTreeActive && displaySnapshot.changes.length > 0
                              ? () => setResetAllOpen(true)
                              : undefined
                          }
                          onRequestDiscard={
                            workingTreeActive ? (paths) => openDiscardFilesDialog(paths) : undefined
                          }
                          disabled={loading}
                        />
                      }
                      secondary={
                        <DiffViewer
                          raw={diff}
                          diffBundles={workingTreeActive ? diffBundles : undefined}
                          file={selectedFile}
                          selection={workingTreeActive ? diffSelection : []}
                          repoPath={selectedPath}
                          section={focus?.kind === "file" ? focus.section : undefined}
                          commit={
                            focus?.kind === "commit" ? focus.commit.hash : viewingCommit?.hash
                          }
                          showWorkingTreeBadges={!viewingCommit}
                          emptyMessage={emptyDiff}
                          disabled={loading}
                          onUnstage={(path) => void unstageFiles([path])}
                          onStageHunk={(filePath, patch) => void stageHunk(filePath, patch)}
                          onUnstageHunk={(filePath, patch) => void unstageHunk(filePath, patch)}
                          onDiscardHunk={(filePath, patch) => void discardHunk(filePath, patch)}
                          onEditLine={(filePath, newLine, expected, text) =>
                            void commitLineEdit(filePath, newLine, expected, text)
                          }
                        />
                      }
                    />

                    {integrationOp && integrationOp.phase === "done" ? (
                      <aside className="integration-panel done">
                        <header className="integration-panel-title">
                          <Check size={15} />
                          Merged {integrationOp.branch} into {integrationOp.onto}
                        </header>
                        <p className="integration-panel-sub">
                          {integrationOp.onto} now includes {integrationOp.branch}.
                          {integrationOp.pushable ? " Push it to share." : ""}
                        </p>
                        {integrationOp.pushable ? (
                          <button
                            type="button"
                            className="commit-primary"
                            disabled={loading}
                            onClick={() => void pushMainAfterMerge()}
                          >
                            Push {integrationOp.onto}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="merge-secondary"
                          onClick={() => void dismissIntegration()}
                        >
                          Done
                        </button>
                      </aside>
                    ) : (
                    <CommitPanel
                      message={commitMessage}
                      messageInputRef={commitMessageRef}
                      branch={displaySnapshot.branch}
                      branches={displaySnapshot.branches ?? []}
                      amend={amend}
                      pushOnCommit={pushOnCommit}
                      hasRemotes={hasRemotes}
                      resetMode={resetMode}
                      selectedCommit={selectedCommit}
                      selectedCommitMessage={viewingCommitMessage}
                      stagedCount={stagedCount}
                      unstagedCount={unstagedCount}
                      changeCount={changeCount}
                      showCommitSection={showCommitSection}
                      showResetSection={showResetSection}
                      showSetupRemote={showSetupRemote}
                      showStartBranch={showCommitSection && onIntegrationBranch && changeCount > 0}
                      nvidiaApiKey={nvidiaApiKey}
                      nvidiaApiKeyConfigured={nvidiaApiKeyConfigured}
                      changeSummary={changeSummary}
                      changeSummaryLoading={changeSummaryLoading}
                      changeSummaryError={changeSummaryError}
                      changeSummaryVisible={changeSummaryVisible}
                      changeSummaryScope={changeSummaryScope}
                      showResummarizeStaged={showResummarizeStaged}
                      showSummarizeAllChanges={showSummarizeAllChanges}
                      showAllChangesSummary={canShowAllChangesSummary}
                      onMessageChange={setCommitMessage}
                      onMessageFocus={handleCommitMessageFocus}
                      onUseSummary={useChangeSummary}
                      onUseSummaryAndCommit={useChangeSummaryAndCommit}
                      onGenerateSummary={prepareCommitSummary}
                      onDismissSummary={dismissChangeSummary}
                      onResummarizeStaged={() => void resummarizeStagedChanges()}
                      onSummarizeAllChanges={() => void summarizeAllChanges()}
                      onShowAllChangesSummary={restoreAllChangesSummary}
                      onNvidiaApiKeyChange={setNvidiaApiKey}
                      onSaveNvidiaApiKey={() => void saveNvidiaApiKeyFromPanel()}
                      onAmendChange={(checked) => void handleAmendChange(checked)}
                      onPushOnCommitChange={(checked) => void handlePushOnCommitChange(checked)}
                      onResetModeChange={setResetMode}
                      onCommit={() => void commit()}
                      onReset={() => void reset()}
                      onSetupRemote={() => openRepoSettings()}
                      onStartBranch={() => setBranchCreateOpen(true)}
                      disabled={loading}
                    />
                    )}
                  </div>
                )}
              </div>
          </>
        ) : (
          <div className="empty-state">
            <GitBranch size={36} />
            <h2>Add a repository to start</h2>
            <p>Browse history, stage changes, review diffs, and commit — all in one window.</p>
            <button type="button" className="commit-primary" onClick={chooseRepoFolder}>
              <FolderPlus size={16} />
              Add Repository
            </button>
          </div>
        )}

        {message || error || gitActivityByPath[selectedPath]?.message || gitActivityByPath[selectedPath]?.error || visibleTerminalSessions.length > 0 ? (
          <ActivityFeed
            message={[message, gitActivityByPath[selectedPath]?.message].filter(Boolean).join("\n")}
            error={[error, gitActivityByPath[selectedPath]?.error].filter(Boolean).join("\n")}
            gitBusy={pushPhase === "pushing" || backupPhase === "pushing" || pullPhase === "pulling"}
            sessions={visibleTerminalSessions}
            onOpenExecution={(session) => setDrawerSessionId(session.runId)}
            onRerun={handleRunAction}
            onClearExecution={(session) =>
              setTerminalSessions((sessions) =>
                sessions.map((current) =>
                  current.runId === session.runId ? { ...current, logs: [] } : current,
                ),
              )
            }
            onDismissExecution={(session) =>
              setTerminalSessions((sessions) =>
                sessions.filter((current) => current.runId !== session.runId),
              )
            }
          />
        ) : null}
      </section>

      {snapshot ? (
        <>
          <ResetAllConfirmDialog
            open={resetAllOpen}
            repoName={snapshot.repo.name}
            changes={snapshot.changes}
            loading={loading || pushPhase !== "idle"}
            onConfirm={(includeUntracked) => void resetAllWorkingTree(includeUntracked)}
            onCancel={() => setResetAllOpen(false)}
          />
          <DiscardFilesConfirmDialog
            open={discardFilesOpen}
            paths={discardFilesTarget}
            changes={snapshot.changes}
            loading={loading}
            onConfirm={() => void discardSelectedFiles()}
            onCancel={() => {
              setDiscardFilesOpen(false);
              setDiscardFilesTarget([]);
            }}
          />
          <BranchCreateDialog
            open={branchCreateOpen}
            fromBranch={snapshot.branch}
            fromCommit={branchFromCommit}
            changes={snapshot.changes ?? []}
            loading={loading}
            onConfirm={(name) => void createBranch(name)}
            onCancel={() => {
              setBranchCreateOpen(false);
              setBranchFromCommit(null);
            }}
          />
          <ResetToCommitDialog
            open={!!resetToTarget}
            branch={snapshot.branch}
            commit={resetToTarget}
            dirtyCount={snapshot.changes?.length ?? 0}
            loading={loading}
            onConfirm={(mode) => resetToTarget && void resetToCommit(resetToTarget, mode)}
            onCancel={() => setResetToTarget(null)}
          />
          <TagCreateDialog
            open={!!tagCreateCommit}
            commit={tagCreateCommit}
            recentTags={snapshot.tags ?? []}
            loading={loading}
            onConfirm={(name) => void submitCreateTag(name)}
            onCancel={() => setTagCreateCommit(null)}
          />
          <TagDeleteDialog
            open={!!tagDeleteTarget}
            commit={tagDeleteTarget?.commit ?? null}
            tagName={tagDeleteTarget?.name ?? ""}
            loading={loading}
            onConfirm={() => void submitDeleteTag()}
            onCancel={() => setTagDeleteTarget(null)}
          />
          <RepoSettingsDrawer
            open={repoSettingsOpen}
            repoName={snapshot.repo.name}
            repoPath={snapshot.repo.path}
            remotes={snapshot.remotes}
            worktrees={worktrees}
            onWorktreesChanged={() => setWorktreeRefresh((n) => n + 1)}
            onConfirmRemove={(entry) => setWorktreeToRemove(entry)}
            onOpenWorktree={(worktreePath) => {
              // Another checkout of the same repository is, to Gitty, just
              // another repo path: add it if it isn't saved yet, then select it.
              setRepoSettingsOpen(false);
              void addRepo(worktreePath);
            }}
            onClose={() => setRepoSettingsOpen(false)}
            onSaveRemote={saveRemote}
            onRemoveRemote={removeRemote}
            onFetch={() => void fetchRepo()}
            onRemoveRepo={() => void removeSelectedRepo()}
            onUpdateFolder={runLinkedFolderUpdate}
            backupAvailable={backupAvailable}
            backupOnPush={snapshot.backupOnPush ?? false}
            hasBackupRemote={hasBackupRemote}
            onBackupOnPushChange={setBackupAfterPush}
            disabled={loading}
          />
        </>
      ) : null}

      <KeyboardSheet open={keyboardSheetOpen} onClose={() => setKeyboardSheetOpen(false)} />

      <RemoveWorktreeConfirmDialog
        worktree={worktreeToRemove}
        loading={removingWorktree}
        onCancel={() => setWorktreeToRemove(null)}
        onConfirm={() => {
          const target = worktreeToRemove;
          if (!target) return;
          setRemovingWorktree(true);
          void (async () => {
            const result = await run(() =>
              invoke<ActionResult>("remove_worktree", {
                path: selectedPath,
                worktree: target.path,
              }),
            );
            setRemovingWorktree(false);
            setWorktreeToRemove(null);
            if (result) {
              setMessage(result.message);
              setWorktreeRefresh((n) => n + 1);
            }
          })();
        }}
      />

      <AppSettingsDrawer
        open={settingsOpen}
        autoSummarizeEnabled={autoSummarizeEnabled}
        fetchOnRefresh={fetchOnRefresh}
        nvidiaApiKeyConfigured={nvidiaApiKeyConfigured}
        nvidiaApiKeyPreview={nvidiaApiKeyPreview}
        settingsNvidiaKey={settingsNvidiaKey}
        nvidiaKeyTesting={nvidiaKeyTesting}
        nvidiaKeyTestMessage={nvidiaKeyTestMessage}
        nvidiaKeyTestError={nvidiaKeyTestError}
        backupRemoteName={backupRemoteName}
        backupUrlTemplate={backupUrlTemplate}
        backupSaving={backupSaving}
        backupSaveMessage={backupSaveMessage}
        backupSaveError={backupSaveError}
        onClose={() => setSettingsOpen(false)}
        onAutoSummarizeEnabledChange={(enabled) => void setAutoSummarizeEnabledSetting(enabled)}
        onFetchOnRefreshChange={(enabled) => void setFetchOnRefreshSetting(enabled)}
        onSettingsNvidiaKeyChange={setSettingsNvidiaKey}
        onSaveNvidiaApiKey={() => void saveNvidiaApiKeyFromSettings()}
        onDeleteNvidiaApiKey={() => void deleteNvidiaApiKey()}
        onTestNvidiaApiKey={() => void testNvidiaApiKey()}
        onBackupRemoteNameChange={setBackupRemoteName}
        onBackupUrlTemplateChange={setBackupUrlTemplate}
        onSaveBackupProfile={() => void saveBackupProfile()}
        disabled={loading}
      />

      {drawerExecution ? (
        <ActionRunnerDrawer
          execution={drawerExecution}
          onClose={() => setDrawerSessionId(null)}
          onRerun={handleRunAction}
          onClearLogs={() =>
            setTerminalSessions((sessions) =>
              sessions.map((current) =>
                current.runId === drawerExecution.runId ? { ...current, logs: [] } : current,
              ),
            )
          }
        />
      ) : null}
    </main>
  );
}

export default App;
