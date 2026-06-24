import { GitMerge, Plus, Minus } from "lucide-react";
import type { BranchEntry } from "../types";

type BranchBarProps = {
  branches: BranchEntry[];
  currentBranch: string;
  mergeTarget: string;
  onMergeTargetChange: (value: string) => void;
  onCheckout: (branch: string) => void;
  onMerge: () => void;
  disabled?: boolean;
};

export function BranchBar({
  branches,
  currentBranch,
  mergeTarget,
  onMergeTargetChange,
  onCheckout,
  onMerge,
  disabled,
}: BranchBarProps) {
  const localBranches = branches.filter((branch) => !branch.isRemote);
  const remoteBranches = branches.filter((branch) => branch.isRemote);

  return (
    <section className="branch-bar">
      <label className="branch-field">
        <span>Branch</span>
        <select
          value={currentBranch}
          disabled={disabled}
          onChange={(event) => onCheckout(event.currentTarget.value)}
        >
          {localBranches.length > 0 ? (
            <optgroup label="Local">
              {localBranches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </optgroup>
          ) : null}
          {remoteBranches.length > 0 ? (
            <optgroup label="Remote">
              {remoteBranches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      <label className="branch-field merge-field">
        <span>Merge</span>
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
      </label>

      <button
        type="button"
        className="toolbar-button"
        disabled={disabled || !mergeTarget}
        onClick={onMerge}
      >
        <GitMerge size={15} />
        Merge
      </button>
    </section>
  );
}

type RemotePanelProps = {
  remotes: Array<{ name: string; url: string; kind: string }>;
  remoteName: string;
  remoteUrl: string;
  onRemoteNameChange: (value: string) => void;
  onRemoteUrlChange: (value: string) => void;
  onSave: () => void;
  onRemove: (name: string) => void;
  disabled?: boolean;
};

export function RemotePanel({
  remotes,
  remoteName,
  remoteUrl,
  onRemoteNameChange,
  onRemoteUrlChange,
  onSave,
  onRemove,
  disabled,
}: RemotePanelProps) {
  const unique = new Map<string, { name: string; url: string; kind: string }>();
  remotes.forEach((remote) => {
    if (remote.kind === "fetch" || !unique.has(remote.name)) {
      unique.set(remote.name, remote);
    }
  });

  return (
    <section className="remote-panel">
      <div className="remote-list">
        {unique.size === 0 ? (
          <span className="muted">No remotes configured</span>
        ) : (
          Array.from(unique.values()).map((remote) => (
            <div className="remote-chip" key={remote.name}>
              <strong>{remote.name}</strong>
              <span>{remote.url}</span>
              <button
                type="button"
                className="icon-button danger"
                title={`Remove ${remote.name}`}
                disabled={disabled}
                onClick={() => onRemove(remote.name)}
              >
                <Minus size={14} />
              </button>
            </div>
          ))
        )}
      </div>
      <form
        className="remote-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <input
          value={remoteName}
          onChange={(event) => onRemoteNameChange(event.currentTarget.value)}
          aria-label="Remote name"
          placeholder="origin"
        />
        <input
          value={remoteUrl}
          onChange={(event) => onRemoteUrlChange(event.currentTarget.value)}
          aria-label="Remote URL"
          placeholder="git@github.com:user/repo.git"
        />
        <button type="submit" className="toolbar-button" disabled={disabled}>
          <Plus size={15} />
          Save
        </button>
      </form>
    </section>
  );
}
