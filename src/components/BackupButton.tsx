import { Loader2 } from "lucide-react";
import type { PushPhase } from "./PushButton";

type BackupButtonProps = {
  enabled: boolean;
  configured: boolean;
  remoteName?: string | null;
  phase?: PushPhase;
  loading?: boolean;
  onChange: (enabled: boolean) => Promise<boolean>;
};

/**
 * Backup is deliberately a push preference rather than a second action to
 * remember. When it is first enabled, the parent sets up and synchronizes the
 * configured backup remote before saving the preference.
 */
export function BackupButton({
  enabled,
  configured,
  remoteName,
  phase = "idle",
  loading,
  onChange,
}: BackupButtonProps) {
  const busy = phase !== "idle" || !!loading;
  const setupHint = configured
    ? `Copy successful pushes to ${remoteName || "the backup remote"}`
    : `Set up and sync ${remoteName || "the"} backup remote, then copy successful pushes to it`;

  return (
    <label className={`backup-push-toggle${busy ? " busy" : ""}`} title={setupHint}>
      {phase === "pushing" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
      <input
        type="checkbox"
        checked={enabled}
        disabled={busy}
        onChange={(event) => void onChange(event.currentTarget.checked)}
      />
      <span>{phase === "pushing" ? "Setting up backup…" : "Back up after push"}</span>
    </label>
  );
}
