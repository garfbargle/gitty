import type { CommitEntry } from "../types";
import { formatDate, parseRefs } from "../lib/git";
import { buildGraphRows, laneColor } from "../lib/graph";

type CommitGraphProps = {
  commits: CommitEntry[];
  selectedHash?: string;
  onSelect: (commit: CommitEntry) => void;
};

export function CommitGraph({ commits, selectedHash, onSelect }: CommitGraphProps) {
  const rows = buildGraphRows(commits);

  return (
    <div className="commit-graph">
      {rows.map((row) => {
        const refs = parseRefs(row.commit.refs);
        const active = row.commit.hash === selectedHash;
        return (
          <button
            className={`commit-row ${active ? "active" : ""}`}
            key={row.commit.hash}
            type="button"
            onClick={() => onSelect(row.commit)}
          >
            <div
              className="commit-rail"
              style={{ width: `${Math.max(row.laneCount, 1) * 14 + 18}px` }}
              aria-hidden="true"
            >
              {Array.from({ length: row.laneCount }).map((_, laneIndex) => (
                <span
                  className={`rail-line ${laneIndex === row.lane ? "primary" : "ghost"} ${
                    laneIndex === row.lane && row.continueDown ? "continue" : ""
                  }`}
                  key={laneIndex}
                  style={{ left: `${10 + laneIndex * 14}px`, borderColor: laneColor(laneIndex) }}
                />
              ))}
              <span
                className="rail-node"
                style={{
                  left: `${10 + row.lane * 14}px`,
                  background: laneColor(row.lane),
                  boxShadow: `0 0 0 2px color-mix(in srgb, ${laneColor(row.lane)} 25%, transparent)`,
                }}
              />
            </div>

            <div className="commit-body">
              <div className="commit-topline">
                <span className="commit-subject">{row.commit.subject}</span>
                <span className="commit-hash">{row.commit.shortHash}</span>
              </div>
              {refs.length > 0 ? (
                <div className="commit-refs">
                  {refs.map((ref) => (
                    <span className="ref-pill" key={ref}>
                      {ref}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="commit-meta">
                {row.commit.author} · {formatDate(row.commit.date)}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
