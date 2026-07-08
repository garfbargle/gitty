import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Code2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Editor = {
  id: string;
  name: string;
  appPath: string;
  icon: string;
};

function EditorGlyph({ editor, size }: { editor: Editor; size: number }) {
  if (editor.icon) {
    return (
      <img
        src={editor.icon}
        alt=""
        width={size}
        height={size}
        className="ide-picker-glyph"
      />
    );
  }
  return <Code2 size={size} className="ide-picker-item-icon" />;
}

const STORAGE_KEY = "gitty.defaultEditor";

type IdePickerProps = {
  repoPath: string;
};

export function IdePicker({ repoPath }: IdePickerProps) {
  const [editors, setEditors] = useState<Editor[]>([]);
  const [defaultId, setDefaultId] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Editor[]>("detect_editors")
      .then((list) => {
        if (cancelled) return;
        setEditors(list);
      })
      .catch(() => {
        if (!cancelled) setEditors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (editors.length === 0) return null;

  const current =
    editors.find((editor) => editor.id === defaultId) ?? editors[0];

  async function openIn(editor: Editor) {
    if (!repoPath) return;
    setBusy(true);
    try {
      await invoke("open_in_editor", {
        targetId: editor.id,
        appPath: editor.appPath,
        path: repoPath,
      });
    } catch {
      // Launch failures are non-fatal; the button simply does nothing.
    } finally {
      setBusy(false);
    }
  }

  function chooseDefault(editor: Editor) {
    setDefaultId(editor.id);
    localStorage.setItem(STORAGE_KEY, editor.id);
    setOpen(false);
    void openIn(editor);
  }

  return (
    <div className={`ide-picker ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="ide-picker-main"
        title={`Open in ${current.name}`}
        aria-label={`Open in ${current.name}`}
        disabled={busy || !repoPath}
        onClick={() => void openIn(current)}
      >
        <EditorGlyph editor={current} size={24} />
      </button>
      <button
        type="button"
        className="ide-picker-caret"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Choose an editor"
        aria-label="Choose an editor"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div className="ide-picker-menu" role="listbox">
          {editors.map((editor) => (
            <button
              key={editor.id}
              type="button"
              role="option"
              aria-selected={editor.id === current.id}
              className={`ide-picker-item ${editor.id === current.id ? "active" : ""}`}
              onClick={() => chooseDefault(editor)}
            >
              <EditorGlyph editor={editor} size={16} />
              <span>{editor.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
