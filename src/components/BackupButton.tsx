import { Archive, Check, Loader2, Settings2 } from "lucide-react";
import type { PushPhase } from "./PushButton";

type BackupButtonProps = {
  configured: boolean;
  remoteName?: string | null;
  phase?: PushPhase;
  loading?: boolean;
  onBackup?: () => Promise<boolean>;
  onSetup?: () => Promise<boolean>;
};

/** Backup remains a deliberate action. Push reaches a backup only when the
 * repository's "Back up after push" setting is enabled. */
export function BackupButton({
  configured,
  remoteName,
  phase = "idle",
  loading,
  onBackup,
  onSetup,
}: BackupButtonProps) {
  const busy = phase !== "idle" || !!loading;
  const settingUp = !configured;
  if (settingUp && !onSetup) return null;

  return (
    <div className={`backup-btn-group ${phase !== "idle" ? phase : ""}`} aria-live="polite">
      <button
        type="button"
        className="backup-btn-main"
        disabled={busy}
        title={settingUp ? `Set up ${remoteName || "a"} backup for this repository` : `Back up this repository to ${remoteName || "its backup remote"}`}
        onClick={() => void (settingUp ? onSetup?.() : onBackup?.())}
      >
        {phase === "pushing" ? <Loader2 size={15} className="spin" /> : phase === "done" ? <Check size={15} /> : settingUp ? <Settings2 size={15} /> : <Archive size={15} />}
        {phase === "pushing" ? (settingUp ? "Setting up…" : "Backing up…") : phase === "done" ? (settingUp ? "Backup ready" : "Backed up") : settingUp ? "Set up backup" : "Backup"}
      </button>
    </div>
  );
}
