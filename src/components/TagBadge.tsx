import { Tag } from "lucide-react";

type TagBadgeProps = {
  name: string;
  unpushed?: boolean;
  muted?: boolean;
};

export function TagBadge({ name, unpushed, muted }: TagBadgeProps) {
  return (
    <span
      className={`tag-badge${unpushed ? " unpushed" : ""}${muted ? " muted" : ""}`}
      title={unpushed ? `${name} — not on remote` : name}
    >
      <Tag size={10} aria-hidden="true" />
      {name}
    </span>
  );
}
