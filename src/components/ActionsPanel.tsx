import { GitBranch, GitMerge, RotateCcw, Send, Trash2 } from "lucide-react";
import type { BranchEntry } from "../types";

type ActionsPanelProps = {
  branches: BranchEntry[];
  currentBranch: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  checkoutBranch: string;
  mergeTarget: string;
  primaryRemote: string;
  onCheckoutBranchChange: (value: string) => void;
  onMergeTargetChange: (value: string) => void;
  onCheckout: () => void;
  onMerge: () => void;
  onResetSoft: () => void;
  onResetHard: () => void;
  onPush: () => void;
  onForcePush: () => void;
  hasSelectedCommit: boolean;
  disabled?: boolean;
};

export function ActionsPanel({
  branches,
  currentBranch,
  upstream,
  ahead,
  behind,
  checkoutBranch,
  mergeTarget,
  primaryRemote,
  onCheckoutBranchChange,
  onMergeTargetChange,
  onCheckout,
  onMerge,
  onResetSoft,
  onResetHard,
  onPush,
  onForcePush,
  hasSelectedCommit,
  disabled,
}: ActionsPanelProps) {
  const localBranches = branches.filter((branch) => !branch.isRemote);

  return (
    <aside className="actions-panel">
      <section className="action-group">
        <h3>Checkout</h3>
        <select
          value={checkoutBranch}
          disabled={disabled}
          onChange={(event) => onCheckoutBranchChange(event.currentTarget.value)}
        >
          {localBranches.map((branch) => (
            <option key={branch.name} value={branch.name}>
              {branch.name}
            </option>
          ))}
          {branches
            .filter((branch) => branch.isRemote)
            .map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
        </select>
        <button type="button" className="action-btn" disabled={disabled} onClick={onCheckout}>
          <GitBranch size={15} />
          Checkout
        </button>
      </section>

      <section className="action-group">
        <h3>Merge</h3>
        <select
          value={mergeTarget}
          disabled={disabled}
          onChange={(event) => onMergeTargetChange(event.currentTarget.value)}
        >
          <option value="">Select branch…</option>
          {localBranches
            .filter((branch) => branch.name !== currentBranch)
            .map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
        </select>
        <button type="button" className="action-btn" disabled={disabled || !mergeTarget} onClick={onMerge}>
          <GitMerge size={15} />
          Merge
        </button>
      </section>

      <section className="action-group">
        <h3>Reset Current Branch</h3>
        <button
          type="button"
          className="action-card"
          disabled={disabled || !hasSelectedCommit}
          onClick={onResetSoft}
        >
          <RotateCcw size={16} />
          <div>
            <strong>Reset Soft</strong>
            <span>Keep changes staged</span>
          </div>
        </button>
        <button
          type="button"
          className="action-card danger"
          disabled={disabled || !hasSelectedCommit}
          onClick={onResetHard}
        >
          <Trash2 size={16} />
          <div>
            <strong>Reset Hard</strong>
            <span>Discard all changes</span>
          </div>
        </button>
      </section>

      <section className="action-group">
        <h3>Remote ({primaryRemote})</h3>
        <div className="sync-status">
          {upstream ? (
            <span>
              {ahead} ahead · {behind} behind
            </span>
          ) : (
            <span>No upstream set</span>
          )}
        </div>
        <button type="button" className="action-card" disabled={disabled} onClick={onPush}>
          <Send size={16} />
          <div>
            <strong>Push</strong>
            <span>
              Push to {upstream || `${primaryRemote}/${currentBranch}`}
            </span>
          </div>
        </button>
        <button type="button" className="action-card danger" disabled={disabled} onClick={onForcePush}>
          <Send size={16} />
          <div>
            <strong>Force Push</strong>
            <span>Force push with lease</span>
          </div>
        </button>
      </section>
    </aside>
  );
}
