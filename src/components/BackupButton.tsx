import { Check, Loader2, Settings2 } from "lucide-react";
import type { PushPhase } from "./PushButton";

type BackupButtonProps = {
  remoteName?: string | null;
  phase?: PushPhase;
  loading?: boolean;
  onSetup: () => Promise<boolean>;
};

/**
 * This button is shown only while a repository still needs its configured
 * backup remote. Successful setup also enables backup-after-push by default.
 */
export function BackupButton({
  remoteName,
  phase = "idle",
  loading,
  onSetup,
}: BackupButtonProps) {
  const busy = phase !== "idle" || !!loading;

  return (
    <button
      type="button"
      className={`backup-setup-btn${phase !== "idle" ? ` ${phase}` : ""}`}
      title={`Set up and sync ${remoteName || "the"} backup for this repository`}
      disabled={busy}
      onClick={() => void onSetup()}
    >
      {phase === "pushing" ? <Loader2 size={15} className="spin" /> : phase === "done" ? <Check size={15} /> : <Settings2 size={15} />}
      {phase === "pushing" ? "Setting up…" : phase === "done" ? "Backup ready" : "Set up backup"}
    </button>
  );
}
