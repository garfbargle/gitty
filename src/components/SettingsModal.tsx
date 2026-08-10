import { useEffect } from "react";
import { X } from "lucide-react";

type SettingsModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /// Extra class on the panel, for the rare surface that needs more room than
  /// the settings width.
  className?: string;
};

export function SettingsModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  className,
}: SettingsModalProps) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={className ? `settings-modal ${className}` : "settings-modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <div>
            <h2 id="settings-modal-title">{title}</h2>
            {subtitle ? <p className="settings-modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-modal-body">{children}</div>

        {footer ? <footer className="settings-modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
