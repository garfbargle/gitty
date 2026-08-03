import { Tag } from "lucide-react";

type TagBadgeProps = {
  name: string;
  unpushed?: boolean;
  muted?: boolean;
  additionalCount?: number;
  title?: string;
};

export function TagBadge({
  name,
  unpushed,
  muted,
  additionalCount = 0,
  title,
}: TagBadgeProps) {
  return (
    <span
      className={`tag-badge${unpushed ? " unpushed" : ""}${muted ? " muted" : ""}`}
      title={title ?? (unpushed ? `${name}, not on remote` : name)}
    >
      <Tag size={10} aria-hidden="true" />
      <span className="tag-badge-name">{name}</span>
      {additionalCount > 0 ? <span className="tag-badge-count">+{additionalCount}</span> : null}
    </span>
  );
}
