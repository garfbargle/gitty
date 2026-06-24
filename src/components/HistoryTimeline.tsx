import type { CommitEntry } from "../types";
import { laneColor } from "../lib/graph";

type HistoryTimelineProps = {
  commits: CommitEntry[];
  changeCount: number;
  selectedHash?: string;
  onSelect: (commit: CommitEntry) => void;
  onSelectWorkingTree: () => void;
  workingTreeActive?: boolean;
};

export function HistoryTimeline({
  commits,
  changeCount,
  selectedHash,
  onSelect,
  onSelectWorkingTree,
  workingTreeActive,
}: HistoryTimelineProps) {
  const visible = [...commits].reverse().slice(-8);

  return (
    <div className="history-timeline">
      <div className="timeline-track">
        {visible.map((commit, index) => {
          const color = laneColor(index % 6);
          const active = commit.hash === selectedHash && !workingTreeActive;
          return (
            <button
              className={`timeline-node ${active ? "active" : ""}`}
              key={commit.hash}
              type="button"
              onClick={() => onSelect(commit)}
              title={`${commit.shortHash} · ${commit.subject}`}
            >
              <span className="node-dot" style={{ background: color, boxShadow: `0 0 12px ${color}55` }} />
              <span className="node-hash">{commit.shortHash}</span>
              <span className="node-subject">{commit.subject}</span>
              {index < visible.length - 1 || changeCount > 0 ? (
                <span className="node-connector" style={{ background: color }} />
              ) : null}
            </button>
          );
        })}

        <button
          className={`timeline-node working-tree ${workingTreeActive ? "active" : ""}`}
          type="button"
          onClick={onSelectWorkingTree}
        >
          <span className="node-dot working" />
          <span className="node-hash">Working Tree</span>
          <span className="node-subject">{changeCount} change{changeCount === 1 ? "" : "s"}</span>
        </button>
      </div>
    </div>
  );
}
