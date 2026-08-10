import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AlertTriangle, ChevronRight, FolderMinus, Loader2, RefreshCw } from "lucide-react";
import type {
  TidyFolderSize,
  TidyProgress,
  TidyRepoResult,
  WorktreeCleanupEntry,
  WorktreeCleanupOutcome,
} from "../types";
import { formatRelativeTime, shortenPath } from "../lib/git";
import { SettingsModal } from "./SettingsModal";

type TidyUpDrawerProps = {
  open: boolean;
  /// Every repository Gitty knows about. The scan never looks anywhere else.
  repoPaths: string[];
  /// The checkout currently open in Gitty. The saved list holds original
  /// clones, so when a linked folder is open it is not otherwise recognisable
  /// as the one the user is standing in.
  openPath: string;
  onClose: () => void;
  /// Something was removed; the open repository may need re-reading.
  onFoldersRemoved: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/// The age at which a folder stops looking like something you are between
/// visits to. Long enough that a branch parked over a holiday survives it.
const STALE_DAYS = 30;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isStale(entry: WorktreeCleanupEntry, now: number): boolean {
  if (entry.missing) return true;
  if (entry.lastUsedAt === null) return false;
  return now - entry.lastUsedAt > STALE_DAYS * DAY_MS;
}

export function TidyUpDrawer({
  open,
  repoPaths,
  openPath,
  onClose,
  onFoldersRemoved,
}: TidyUpDrawerProps) {
  const [results, setResults] = useState<TidyRepoResult[]>([]);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<TidyProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [sizing, setSizing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The scan this panel is showing. Held in a ref because the event handlers
  // are registered once per opening and would otherwise close over the id from
  // first render.
  const scanIdRef = useRef(0);
  const repoPathsRef = useRef(repoPaths);
  repoPathsRef.current = repoPaths;
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;

  const startScan = useCallback(async () => {
    setResults([]);
    setSizes({});
    setSelected([]);
    setExpanded([]);
    setError(null);
    setProgress(null);
    setScanning(true);
    setSizing(true);
    try {
      scanIdRef.current = await invoke<number>("start_tidy_scan", {
        paths: repoPathsRef.current,
        openPath: openPathRef.current || null,
      });
    } catch (err) {
      setError(String(err));
      setScanning(false);
      setSizing(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      void invoke("cancel_tidy_scan").catch(() => {});
      return;
    }

    let active = true;
    const unlisteners: UnlistenFn[] = [];

    // Which scan an event belongs to.
    //
    // Ids are allocated by the backend and only ever go up, and starting a scan
    // cancels the one before it, so "anything older than the newest id I have
    // seen" is exactly the set to drop — a superseded scan keeps emitting for a
    // moment after it is cancelled.
    //
    // It has to adopt a *higher* id rather than compare against a stored one,
    // because the backend starts emitting the moment the thread spawns and that
    // can beat the `start_tidy_scan` reply carrying the id back. Comparing
    // against the id we knew about dropped the first repositories of every
    // scan, and the fastest repositories are the ones that lose that race.
    const accept = (scanId: number) => {
      if (scanId < scanIdRef.current) return false;
      scanIdRef.current = scanId;
      return true;
    };

    void (async () => {
      const register = async <T,>(name: string, handler: (payload: T) => void) => {
        const unlisten = await listen<T>(name, (event) => {
          if (!active) return;
          handler(event.payload);
        });
        if (!active) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      };

      await register<TidyRepoResult>("tidy-scan-repo", (payload) => {
        if (!accept(payload.scanId)) return;
        // A repository with nothing to say is dropped here rather than rendered
        // as an empty group: most of the saved repositories are tidy, and empty
        // rows for them would bury the handful that are not.
        if (payload.entries.length === 0 && !payload.error) return;
        // Sorted on arrival: results land in completion order, so without this
        // the list reshuffles itself as the slower repositories report in.
        setResults((current) =>
          [...current, payload].sort((a, b) => a.repoName.localeCompare(b.repoName)),
        );
      });

      await register<TidyProgress>("tidy-scan-progress", (payload) => {
        if (!accept(payload.scanId)) return;
        setProgress(payload);
      });

      await register<TidyProgress>("tidy-scan-finished", (payload) => {
        if (!accept(payload.scanId)) return;
        setScanning(false);
      });

      await register<TidyFolderSize>("tidy-scan-size", (payload) => {
        if (!accept(payload.scanId)) return;
        setSizes((current) => ({ ...current, [payload.path]: payload.bytes }));
      });

      await register<number>("tidy-scan-sizes-finished", (scanId) => {
        if (!accept(scanId)) return;
        setSizing(false);
      });

      if (active) await startScan();
    })();

    return () => {
      active = false;
      for (const unlisten of unlisteners) unlisten();
      void invoke("cancel_tidy_scan").catch(() => {});
    };
  }, [open, startScan]);

  const now = Date.now();
  const removable = useMemo(
    () =>
      results.flatMap((repo) => repo.entries.filter((entry) => entry.verdict !== "keep")),
    [results],
  );
  const safe = removable.filter((entry) => entry.verdict === "safe");
  const stale = safe.filter((entry) => isStale(entry, now));
  const selectable = useMemo(
    () => new Set(removable.map((entry) => entry.path)),
    [removable],
  );
  const chosen = selected.filter((path) => selectable.has(path));
  const chosenBytes = chosen.reduce((total, path) => total + (sizes[path] ?? 0), 0);
  const totalBytes = safe.reduce((total, entry) => total + (sizes[entry.path] ?? 0), 0);

  function toggle(path: string) {
    setSelected((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  function toggleRepo(path: string) {
    setExpanded((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  async function removeChosen() {
    setBusy(true);
    setError(null);
    const byRepo = new Map<string, string[]>();
    results.forEach((repo) => {
      const paths = repo.entries
        .map((entry) => entry.path)
        .filter((path) => chosen.includes(path));
      if (paths.length > 0) byRepo.set(repo.repoPath, paths);
    });

    const failures: string[] = [];
    const removed: string[] = [];
    for (const [repoPath, paths] of byRepo) {
      try {
        const outcome = await invoke<WorktreeCleanupOutcome>("remove_worktrees", {
          path: repoPath,
          worktrees: paths,
        });
        removed.push(...outcome.removed);
        outcome.failures.forEach((failure) =>
          failures.push(`${failure.path}: ${failure.message}`),
        );
      } catch (err) {
        // One unreachable repository must not abandon the other twelve.
        failures.push(`${repoPath}: ${String(err)}`);
      }
    }

    // Drop what went, keep everything else — deliberately not a re-scan.
    //
    // Each folder is judged on its own: whether one is finished with says
    // nothing about any other, so removing three teaches the scan nothing it
    // does not already know. Re-running it would throw away the size walk,
    // which is minutes of work, to arrive back at the same list minus the rows
    // we can simply delete. A folder that resisted removal stays put, still
    // ticked, with the reason underneath.
    const gone = new Set(removed);
    setResults((current) =>
      current
        .map((repo) => ({
          ...repo,
          entries: repo.entries.filter((entry) => !gone.has(entry.path)),
        }))
        .filter((repo) => repo.entries.length > 0 || repo.error),
    );
    setSelected((current) => current.filter((path) => !gone.has(path)));
    setSizes((current) => {
      const next = { ...current };
      gone.forEach((path) => delete next[path]);
      return next;
    });

    setBusy(false);
    onFoldersRemoved();
    if (failures.length > 0) {
      setError(
        `Removed ${removed.length} folder(s). ${failures.length} could not be removed:\n${failures.join("\n")}`,
      );
    }
  }

  const scanned = progress?.scanned ?? 0;
  const total = progress?.total ?? repoPaths.length;

  return (
    <SettingsModal
      open={open}
      title="Tidy up"
      subtitle="Folders across every repository that nothing depends on"
      onClose={onClose}
      className="tidy-modal"
      footer={
        <div className="confirm-dialog-actions">
          <button type="button" className="settings-btn" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="action-btn danger confirm-dialog-primary"
            disabled={busy || chosen.length === 0}
            onClick={() => void removeChosen()}
          >
            {busy ? <Loader2 size={13} className="spin" /> : <FolderMinus size={13} />}
            {chosen.length === 1 ? "Remove 1 folder" : `Remove ${chosen.length} folders`}
            {chosenBytes > 0 ? ` (${formatBytes(chosenBytes)})` : ""}
          </button>
        </div>
      }
    >
      <div className="tidy-summary">
        <div className="tidy-summary-figure">
          <strong>{safe.length}</strong>
          <span>finished</span>
        </div>
        <div className="tidy-summary-figure">
          <strong>{totalBytes > 0 ? formatBytes(totalBytes) : "—"}</strong>
          <span>{sizing ? "measuring…" : "on disk"}</span>
        </div>
        <p className="tidy-summary-copy">
          {scanning
            ? `Checking ${scanned} of ${total} repositories…`
            : `Checked ${total} ${total === 1 ? "repository" : "repositories"}. Everything listed as finished is saved and exists somewhere else too.`}
        </p>
      </div>

      {/* Nothing is ticked by default. A list this long is one nobody scrolls,
          and a pre-ticked list that nobody scrolls is a removal nobody agreed
          to. Both buttons below make the tick an act. */}
      <div className="tidy-select-row">
        <button
          type="button"
          className="settings-btn"
          disabled={busy || stale.length === 0}
          onClick={() => setSelected(stale.map((entry) => entry.path))}
        >
          Select {stale.length} untouched for {STALE_DAYS}+ days
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={busy || safe.length === 0}
          onClick={() => setSelected(safe.map((entry) => entry.path))}
        >
          Select all {safe.length} finished
        </button>
        {chosen.length > 0 ? (
          <button
            type="button"
            className="settings-inline-link"
            disabled={busy}
            onClick={() => setSelected([])}
          >
            Clear
          </button>
        ) : null}
        {/* Removing no longer re-scans, so the one case that needs a fresh
            look — work done elsewhere while this panel sat open — needs a way
            to ask for one. */}
        <button
          type="button"
          className="settings-inline-link tidy-rescan"
          disabled={busy || scanning}
          onClick={() => void startScan()}
        >
          {scanning ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          Rescan
        </button>
      </div>

      {!scanning && results.length === 0 ? (
        <p className="settings-hint">
          Nothing to tidy. Every repository has only the folders it's using.
        </p>
      ) : null}

      <ul className="tidy-repo-list">
        {results.map((repo) => {
          const expandedRepo = expanded.includes(repo.repoPath);
          const repoSafe = repo.entries.filter((entry) => entry.verdict === "safe");
          const repoBytes = repo.entries.reduce(
            (sum, entry) => sum + (sizes[entry.path] ?? 0),
            0,
          );
          const repoChosen = repo.entries.filter((entry) => chosen.includes(entry.path)).length;

          return (
            <li key={repo.repoPath} className="tidy-repo">
              <button
                type="button"
                className={`tidy-repo-head${expandedRepo ? " open" : ""}`}
                onClick={() => toggleRepo(repo.repoPath)}
              >
                <ChevronRight size={13} className="tidy-chevron" />
                <span className="tidy-repo-name">{repo.repoName}</span>
                {repo.error ? (
                  <span className="tidy-repo-error">
                    <AlertTriangle size={11} /> couldn't be read
                  </span>
                ) : (
                  <span className="tidy-repo-meta">
                    {repoSafe.length} finished
                    {repo.entries.length > repoSafe.length
                      ? ` · ${repo.entries.length - repoSafe.length} to check`
                      : ""}
                    {repoBytes > 0 ? ` · ${formatBytes(repoBytes)}` : ""}
                  </span>
                )}
                {repoChosen > 0 ? <span className="tidy-repo-chosen">{repoChosen}</span> : null}
              </button>

              {expandedRepo ? (
                repo.error ? (
                  <p className="settings-error">{repo.error}</p>
                ) : (
                  <ul className="cleanup-list tidy-folder-list">
                    {repo.entries.map((entry) => {
                      const canPick = entry.verdict !== "keep";
                      const age =
                        entry.lastUsedAt === null
                          ? null
                          : formatRelativeTime(new Date(entry.lastUsedAt).toISOString());
                      const bytes = sizes[entry.path];
                      return (
                        <li key={entry.path} className={`cleanup-item ${entry.verdict}`}>
                          <label className="cleanup-item-main">
                            <input
                              type="checkbox"
                              checked={canPick && selected.includes(entry.path)}
                              disabled={!canPick || busy}
                              onChange={() => toggle(entry.path)}
                            />
                            <span className="cleanup-item-text">
                              <span className="cleanup-item-title">
                                {entry.branch ?? "a single commit"}
                                {entry.missing ? (
                                  <em className="worktree-badge missing">missing</em>
                                ) : null}
                                {age && !entry.missing ? (
                                  <em className="cleanup-item-age">last used {age}</em>
                                ) : null}
                                {bytes ? (
                                  <em className="cleanup-item-age">{formatBytes(bytes)}</em>
                                ) : null}
                              </span>
                              <small title={entry.path}>{shortenPath(entry.path)}</small>
                              <span className="cleanup-item-reason">{entry.reason}</span>
                              {entry.warnings.map((warning) => (
                                <span className="cleanup-item-warning" key={warning}>
                                  <AlertTriangle size={11} />
                                  {warning}
                                </span>
                              ))}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? <p className="settings-error">{error}</p> : null}
    </SettingsModal>
  );
}
