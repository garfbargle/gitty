import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, Tags, Trash2 } from "lucide-react";
import type { TagEntry } from "../types";
import { formatRelativeTime } from "../lib/git";
import { TagBadge } from "./TagBadge";

type TagBrowserProps = {
  tags: TagEntry[];
  onSelect: (tag: TagEntry) => void;
  onDelete?: (tag: TagEntry) => void;
};

export function TagBrowser({ tags, onSelect, onDelete }: TagBrowserProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();

  const visibleTags = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tags;
    return tags.filter((tag) =>
      [tag.name, tag.commit?.subject ?? "", tag.shortHash].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [query, tags]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    inputRef.current?.focus();

    function closeOnOutsidePress(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="tag-browser" ref={rootRef}>
      <button
        type="button"
        className={`tag-browser-trigger${open ? " active" : ""}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((current) => !current)}
      >
        <Tags size={12} aria-hidden />
        <span>Tags</span>
        <em>{tags.length}</em>
      </button>

      {open ? (
        <section className="tag-browser-popover" id={popoverId} aria-label="Repository tags">
          <label className="tag-browser-search">
            <Search size={13} aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Find a tag"
              aria-label="Find a tag"
            />
          </label>

          <div className="tag-browser-summary">
            <span>{query ? `${visibleTags.length} matching` : "All repository tags"}</span>
            {tags.some((tag) => tag.unpushed) ? <em>Dashed means not pushed</em> : null}
          </div>

          {visibleTags.length > 0 ? (
            <ul className="tag-browser-list">
              {visibleTags.map((tag) => (
                <li key={tag.name}>
                  <button
                    type="button"
                    className="tag-browser-row"
                    onClick={() => {
                      onSelect(tag);
                      setOpen(false);
                    }}
                    title={`${tag.name} · ${tag.commit?.subject ?? "Tagged commit"}`}
                  >
                    <TagBadge name={tag.name} unpushed={tag.unpushed} />
                    <span className="tag-browser-row-copy">
                      <strong>{tag.commit?.subject || "Tagged commit"}</strong>
                      <small>
                        <code>{tag.shortHash}</code>
                        {tag.date ? ` · ${formatRelativeTime(tag.date, now)}` : ""}
                      </small>
                    </span>
                  </button>
                  {onDelete ? (
                    <button
                      type="button"
                      className="tag-browser-delete"
                      aria-label={`Delete tag ${tag.name}`}
                      title={`Delete ${tag.name}`}
                      onClick={() => {
                        onDelete(tag);
                        setOpen(false);
                      }}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="tag-browser-empty">No tags match “{query.trim()}”.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
