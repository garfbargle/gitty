import { useEffect } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  CircleAlert,
  GitMerge,
  Loader2,
  Terminal,
} from "lucide-react";
import type { CommitEntry, MergeAnalysis, MergePhase } from "../types";

type StepState = "done" | "active" | "pending" | "error";

type MergeStep = {
  label: string;
  detail?: string;
  state: StepState;
  index: number;
};

type MergePanelProps = {
  analysis: MergeAnalysis | null;
  source: string;
  target: string;
  currentBranch: string;
  phase: MergePhase;
  loading: boolean;
  running: boolean;
  hasRemotes: boolean;
  conflictCount: number;
  pushed: boolean;
  onMerge: () => void;
  onCancel: () => void;
  onSwapDirection: () => void;
  onCompleteMerge: () => void;
  onAbort: () => void;
  onPush: () => void;
  onShowCommands: () => void;
  onBackToWorkingTree: () => void;
};

function stepIcon(state: StepState, index: number) {
  if (state === "done") return <Check size={13} />;
  if (state === "active") return <Loader2 size={13} className="spin-slow" />;
  if (state === "error") return <CircleAlert size={13} />;
  return <span className="merge-step-num">{index}</span>;
}

export function MergePanel({
  analysis,
  source,
  target,
  currentBranch,
  phase,
  loading,
  running,
  hasRemotes,
  conflictCount,
  pushed,
  onMerge,
  onCancel,
  onSwapDirection,
  onCompleteMerge,
  onAbort,
  onPush,
  onShowCommands,
  onBackToWorkingTree,
}: MergePanelProps) {
  const conflicts = phase === "conflicts";
  const done = phase === "done";
  const merging = phase === "merging" || running;

  const cleanState: StepState = analysis
    ? analysis.workingTreeClean
      ? "done"
      : "error"
    : "pending";
  const fetchState: StepState = done ? "done" : "done";
  const updateState: StepState = analysis
    ? analysis.targetBehind > 0 && !done
      ? "active"
      : "done"
    : "pending";
  const mergeState: StepState = done
    ? "done"
    : conflicts
      ? "error"
      : merging
        ? "active"
        : "active";
  const pushState: StepState = !hasRemotes
    ? "pending"
    : pushed
      ? "done"
      : done
        ? "active"
        : "pending";

  const steps: MergeStep[] = [
    {
      label: "Working tree clean",
      detail: analysis && !analysis.workingTreeClean ? "Commit or stash first" : undefined,
      state: cleanState,
      index: 1,
    },
    { label: "Fetch latest", detail: "Up to date", state: fetchState, index: 2 },
    {
      label: `Update ${target}`,
      detail:
        analysis && analysis.targetBehind > 0
          ? `${analysis.targetBehind} behind`
          : "Already up to date",
      state: updateState,
      index: 3,
    },
    {
      label: "Merge branch",
      detail: conflicts
        ? `${conflictCount} need resolution`
        : done
          ? "Merged"
          : "Ready to merge",
      state: mergeState,
      index: 4,
    },
    {
      label: `Push ${target}`,
      detail: !hasRemotes ? "No remote" : pushed ? "Pushed" : "After merge",
      state: pushState,
      index: 5,
    },
  ];

  const commits: CommitEntry[] = analysis?.commits ?? [];
  const fileCount = analysis?.files.length ?? 0;
  const previewCommits = commits.slice(0, 3);
  const extraCommits = commits.length - previewCommits.length;

  const canMerge =
    !!analysis &&
    !analysis.alreadyUpToDate &&
    analysis.workingTreeClean &&
    !loading &&
    !merging;

  // Everything is framed as "merge source into target" — unambiguous whether
  // you're shipping your branch up or pulling a sibling into the current one.
  const currentIsSource = currentBranch === source;
  const currentIsTarget = currentBranch === target;
  const swapLabel = currentIsSource
    ? `Update this branch from ${target} instead`
    : currentIsTarget
      ? `Merge ${target} into ${source} instead`
      : `Merge ${target} into ${source} instead`;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      if (conflicts) {
        if (conflictCount === 0) {
          event.preventDefault();
          onCompleteMerge();
        }
        return;
      }
      if (canMerge) {
        event.preventDefault();
        onMerge();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canMerge, conflicts, conflictCount, onMerge, onCompleteMerge]);

  return (
    <aside className="commit-panel merge-panel">
      <section className="panel-block">
        <header className="panel-title merge-panel-title">
          <GitMerge size={14} />
          <span>
            {conflicts ? "Resolve merge:" : "Merge:"}{" "}
            <strong className="merge-branch-name source">{source}</strong>
            <ChevronRight size={12} className="merge-arrow" />
            <strong className="merge-branch-name target">{target}</strong>
          </span>
        </header>

        <ol className="merge-steps">
          {steps.map((step) => (
            <li key={step.label} className={`merge-step ${step.state}`}>
              <span className="merge-step-icon">{stepIcon(step.state, step.index)}</span>
              <span className="merge-step-body">
                <span className="merge-step-label">{step.label}</span>
                {step.detail ? (
                  <span className="merge-step-detail">{step.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>

        {done ? (
          <div className="merge-card merge-card-success">
            <div className="merge-card-head">
              <Check size={14} />
              <span>Merged into {target}</span>
            </div>
            <p className="merge-card-sub">
              {target} now includes {source}.
              {hasRemotes && !pushed ? " Push to share it." : ""}
            </p>
          </div>
        ) : (
          <>
            {loading && !analysis ? (
              <div className="merge-card merge-card-muted">
                <Loader2 size={14} className="spin" />
                <span>Analyzing merge…</span>
              </div>
            ) : analysis?.alreadyUpToDate ? (
              <div className="merge-card merge-card-muted">
                <Check size={14} />
                <span>{target} already contains {source}. Nothing to merge.</span>
              </div>
            ) : analysis ? (
              <div className="merge-card">
                <div className="merge-card-head">
                  <span className="merge-count">{commits.length}</span>
                  <span>
                    commit{commits.length === 1 ? "" : "s"} will be added
                  </span>
                </div>
                <ul className="merge-commit-list">
                  {previewCommits.map((commit) => (
                    <li key={commit.hash} title={commit.subject}>
                      {commit.subject}
                    </li>
                  ))}
                </ul>
                <div className="merge-card-foot">
                  + {fileCount} file{fileCount === 1 ? "" : "s"} changed
                  {extraCommits > 0 ? ` · ${extraCommits} more commit${extraCommits === 1 ? "" : "s"}` : ""}
                </div>
              </div>
            ) : null}

            {analysis && !analysis.alreadyUpToDate ? (
              conflicts || analysis.hasConflicts ? (
                <div className="merge-safety merge-safety-warn">
                  <AlertTriangle size={14} />
                  <div>
                    <strong>
                      {conflicts
                        ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"} to resolve`
                        : `${analysis.conflictFiles.length} conflict${analysis.conflictFiles.length === 1 ? "" : "s"} expected`}
                    </strong>
                    <p>
                      {conflicts
                        ? "Resolve every file above, then complete the merge."
                        : "Gitty found overlapping changes you'll need to resolve."}
                    </p>
                  </div>
                </div>
              ) : analysis.conflictsKnown ? (
                <div className="merge-safety merge-safety-ok">
                  <Check size={14} />
                  <div>
                    <strong>No conflicts expected</strong>
                    <p>Gitty analyzed the changes and found none.</p>
                  </div>
                </div>
              ) : null
            ) : null}
          </>
        )}

        {/* Primary actions */}
        {conflicts ? (
          <>
            <button
              type="button"
              className="commit-primary merge-primary"
              disabled={conflictCount > 0 || loading}
              onClick={onCompleteMerge}
            >
              Complete merge
              <kbd>⌘↵</kbd>
            </button>
            <button type="button" className="merge-secondary danger" onClick={onAbort}>
              Abort merge
            </button>
          </>
        ) : done ? (
          <>
            {hasRemotes && !pushed ? (
              <button
                type="button"
                className="commit-primary merge-primary"
                disabled={loading}
                onClick={onPush}
              >
                <ArrowDownToLine size={15} style={{ transform: "rotate(180deg)" }} />
                Push {target}
              </button>
            ) : null}
            <button type="button" className="merge-secondary" onClick={onBackToWorkingTree}>
              Back to working tree
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="commit-primary merge-primary"
              disabled={!canMerge}
              onClick={onMerge}
            >
              {merging ? <Loader2 size={15} className="spin" /> : <GitMerge size={15} />}
              {`Merge into ${target}`}
              <kbd>⌘↵</kbd>
            </button>
            <button type="button" className="merge-secondary" onClick={onCancel} disabled={merging}>
              Cancel
            </button>
            <button
              type="button"
              className="merge-link"
              onClick={onSwapDirection}
              disabled={merging}
            >
              {swapLabel}
            </button>
          </>
        )}

        <button type="button" className="merge-link merge-commands" onClick={onShowCommands}>
          <Terminal size={12} />
          Show commands
        </button>
      </section>
    </aside>
  );
}
