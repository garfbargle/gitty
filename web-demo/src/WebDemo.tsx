import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Cloud,
  Code2,
  Download,
  FileCode2,
  FolderGit2,
  GitBranch,
  History,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import "./web-demo.css";

type DemoChange = {
  path: string;
  status: "M" | "A";
  staged: boolean;
  diff: string;
};

type DemoCommit = {
  hash: string;
  subject: string;
  author: string;
  date: string;
};

const initialChanges: DemoChange[] = [
  {
    path: "src/components/CommitPanel.tsx",
    status: "M",
    staged: false,
    diff: [
      "@@ -42,7 +42,11 @@ export function CommitPanel() {",
      "-  const canCommit = stagedFiles.length > 0;",
      "+  const canCommit = stagedFiles.length > 0 && message.trim().length > 0;",
      "+",
      "+  const hint = canCommit",
      '+    ? "Ready to commit"',
      '+    : "Stage a file and write a message";',
    ].join("\n"),
  },
  {
    path: "src/lib/commitMessage.ts",
    status: "A",
    staged: false,
    diff: [
      "+export function suggestedMessage(files: string[]) {",
      "+  return files.length === 1",
      "+    ? `update ${files[0]}`",
      "+    : `update ${files.length} files`;",
      "+}",
    ].join("\n"),
  },
  {
    path: "README.md",
    status: "M",
    staged: true,
    diff: [
      "@@ -3,6 +3,8 @@",
      " Fast, keyboard-driven Git for macOS, Windows, and Linux.",
      "+",
      "+Try the interactive Gitty demo at gitty.c0di.com.",
    ].join("\n"),
  },
];

const initialCommits: DemoCommit[] = [
  { hash: "9f4c2e1", subject: "refine conflict resolution flow", author: "Codi", date: "2 hours ago" },
  { hash: "6a1d8b7", subject: "add keyboard navigation to history", author: "Codi", date: "Yesterday" },
  { hash: "3b0e9a4", subject: "initial Gitty workspace", author: "Codi", date: "Jul 24" },
];

function shortPath(path: string) {
  const pieces = path.split("/");
  return pieces.length > 2 ? `…/${pieces.slice(-2).join("/")}` : path;
}

function ChangeGroup({
  title,
  changes,
  selectedPath,
  onSelect,
  onToggle,
}: {
  title: string;
  changes: DemoChange[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  return (
    <div className="demo-change-group">
      <p>{title}</p>
      {changes.map((change) => (
        <div className={`demo-file ${selectedPath === change.path ? "selected" : ""}`} key={change.path}>
          <button className="demo-file-name" onClick={() => onSelect(change.path)}>
            <span className={`demo-status-letter ${change.status === "A" ? "added" : ""}`}>{change.status}</span>
            {shortPath(change.path)}
          </button>
          <button className="demo-stage" onClick={() => onToggle(change.path)}>
            {change.staged ? "Unstage" : "Stage"}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function WebDemo() {
  const [changes, setChanges] = useState<DemoChange[]>(initialChanges);
  const [selectedPath, setSelectedPath] = useState(initialChanges[0].path);
  const [message, setMessage] = useState("");
  const [commits, setCommits] = useState<DemoCommit[]>(initialCommits);
  const [pushed, setPushed] = useState(false);
  const [notice, setNotice] = useState("Stage the two remaining changes, then create a commit.");
  const [view, setView] = useState<"changes" | "history">("changes");

  const selected = changes.find((change) => change.path === selectedPath) ?? changes[0];
  const staged = changes.filter((change) => change.staged);
  const unstaged = changes.filter((change) => !change.staged);
  const canCommit = staged.length > 0 && message.trim().length > 0;
  const status = useMemo(() => (pushed ? "Everything is synced to the demo remote." : notice), [notice, pushed]);

  useEffect(() => {
    document.title = "Gitty — Try the demo";
    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.setAttribute("name", "description");
      document.head.append(description);
    }
    description.setAttribute("content", "Try Gitty's keyboard-first Git workflow in your browser.");
  }, []);

  function toggleStage(path: string) {
    setChanges((current) => current.map((change) => change.path === path ? { ...change, staged: !change.staged } : change));
    setPushed(false);
    setNotice("Changes are saved only in this browser demo.");
  }

  function stageAll() {
    setChanges((current) => current.map((change) => ({ ...change, staged: true })));
    setPushed(false);
    setNotice("All demo changes are staged. Write a commit message to continue.");
  }

  function commit() {
    if (!canCommit) return;
    setCommits((current) => [{
      hash: Math.random().toString(16).slice(2, 9),
      subject: message.trim(),
      author: "You (demo)",
      date: "Just now",
    }, ...current]);
    setChanges((current) => current.filter((change) => !change.staged));
    setMessage("");
    setPushed(false);
    setView("history");
    setNotice("Commit created. Push it to finish the walkthrough.");
  }

  function push() {
    setPushed(true);
    setNotice("Demo push completed.");
  }

  function reset() {
    setChanges(initialChanges);
    setSelectedPath(initialChanges[0].path);
    setMessage("");
    setCommits(initialCommits);
    setPushed(false);
    setView("changes");
    setNotice("Demo reset. Nothing here touches your computer or a real repository.");
  }

  return (
    <main className="demo-shell">
      <header className="demo-banner">
        <span><Sparkles size={15} /> Interactive browser demo</span>
        <p>This is a safe, simulated repository. Download Gitty Desktop to work with your real local Git repositories.</p>
        <div className="demo-banner-actions">
          <a className="demo-link" href="https://github.com/garfbargle/gitty/releases"><Download size={15} /> Download desktop</a>
          <a className="demo-link demo-link-secondary" href="https://github.com/garfbargle/gitty"><Code2 size={15} /> View source</a>
        </div>
      </header>

      <section className="demo-app" aria-label="Gitty interactive demo">
        <aside className="demo-sidebar">
          <div className="demo-wordmark"><FolderGit2 size={20} /> Gitty</div>
          <p className="demo-sidebar-label">Demo repository</p>
          <button className="demo-repo active"><span className="demo-repo-icon">G</span><span><strong>gitty-demo</strong><small>3 changes</small></span></button>
          <nav className="demo-nav" aria-label="Demo view">
            <button className={view === "changes" ? "active" : ""} onClick={() => setView("changes")}><FileCode2 size={16} /> Changes <span>{changes.length}</span></button>
            <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><History size={16} /> History</button>
          </nav>
          <div className="demo-sidebar-footer">
            <span><Cloud size={15} /> Browser-only sandbox</span>
            <button onClick={reset}><RotateCcw size={14} /> Reset demo</button>
          </div>
        </aside>

        <div className="demo-main">
          <div className="demo-toolbar">
            <div><strong>gitty-demo</strong><span className="demo-path">~/Demo/gitty-demo</span></div>
            <button className="demo-branch"><GitBranch size={15} /> main <ChevronRight size={14} /></button>
            <div className="demo-toolbar-spacer" />
            <button className="demo-push" onClick={push} disabled={pushed || commits.length === initialCommits.length}><Cloud size={15} /> {pushed ? "Pushed" : "Push"}</button>
          </div>

          {view === "changes" ? (
            <div className="demo-workspace">
              <section className="demo-changes-panel">
                <div className="demo-panel-heading"><div><strong>Changes</strong><span>{changes.length} files</span></div><button onClick={stageAll} disabled={unstaged.length === 0}>Stage all</button></div>
                {unstaged.length > 0 && <ChangeGroup title="Unstaged" changes={unstaged} selectedPath={selectedPath} onSelect={setSelectedPath} onToggle={toggleStage} />}
                {staged.length > 0 && <ChangeGroup title="Staged" changes={staged} selectedPath={selectedPath} onSelect={setSelectedPath} onToggle={toggleStage} />}
                {changes.length === 0 && <div className="demo-empty"><Check size={22} /> Working tree is clean</div>}
              </section>
              <section className="demo-diff-panel">
                <div className="demo-panel-heading"><div><strong>{selected ? shortPath(selected.path) : "No file selected"}</strong><span>{selected?.staged ? "Staged" : "Unstaged"}</span></div></div>
                {selected ? <pre className="demo-diff">{selected.diff}</pre> : <div className="demo-empty">Select a changed file to see its diff.</div>}
              </section>
              <section className="demo-commit-panel">
                <div className="demo-panel-heading"><div><strong>Commit</strong><span>{staged.length} staged file{staged.length === 1 ? "" : "s"}</span></div></div>
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe this change" aria-label="Commit message" />
                <p className="demo-shortcut">Tip: <kbd>⌘</kbd> <kbd>Enter</kbd> commits in the desktop app.</p>
                <button className="demo-commit" onClick={commit} disabled={!canCommit}><Check size={16} /> Commit staged changes</button>
                <p className="demo-note">Demo commits are kept only in this tab. Gitty Desktop uses your system Git and the repositories you choose.</p>
              </section>
            </div>
          ) : (
            <section className="demo-history">
              <div className="demo-history-heading"><div><span className="demo-history-dot" /><strong>main</strong></div><button onClick={() => setView("changes")}>Back to changes</button></div>
              {commits.map((commit, index) => <article className="demo-commit-row" key={`${commit.hash}-${index}`}><span className="demo-graph"><i />{index < commits.length - 1 && <b />}</span><div><strong>{commit.subject}</strong><p>{commit.author} · {commit.date}</p></div><code>{commit.hash}</code></article>)}
            </section>
          )}
          <footer className="demo-status"><span className={pushed ? "synced" : ""}>{pushed ? <Check size={15} /> : <Sparkles size={15} />}{status}</span><span>Demo mode · no system shell · no real Git remote</span></footer>
        </div>
      </section>
    </main>
  );
}
