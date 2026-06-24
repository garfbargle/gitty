import type { CommitEntry } from "../types";
import {
  authorInitials,
  formatCommitDate,
  formatCommitTime,
  parseRefs,
  primaryRef,
} from "../lib/git";
import { buildGraphRows, laneColor } from "../lib/graph";

type HistoryTableProps = {
  commits: CommitEntry[];
  selectedHash?: string;
  search: string;
  onSelect: (commit: CommitEntry) => void;
  onDoubleClick: (commit: CommitEntry) => void;
};

export function HistoryTable({
  commits,
  selectedHash,
  search,
  onSelect,
  onDoubleClick,
}: HistoryTableProps) {
  const query = search.trim().toLowerCase();
  const filtered = query
    ? commits.filter(
        (commit) =>
          commit.subject.toLowerCase().includes(query) ||
          commit.author.toLowerCase().includes(query) ||
          commit.shortHash.toLowerCase().includes(query) ||
          commit.refs.toLowerCase().includes(query),
      )
    : commits;
  const rows = buildGraphRows(filtered);
  const graphWidth = Math.max(...rows.map((row) => row.laneCount), 1) * 14 + 24;

  return (
    <div className="history-table-wrap">
      <div className="history-table">
        <div className="history-header">
          <span className="col-graph">Graph</span>
          <span className="col-branch">Branch</span>
          <span className="col-message">Commit message</span>
          <span className="col-hash">Hash</span>
          <span className="col-date">Date</span>
          <span className="col-time">Time</span>
          <span className="col-author">Author</span>
        </div>

        <div className="history-body">
          {rows.map((row) => {
            const refs = parseRefs(row.commit.refs);
            const mainRef = primaryRef(row.commit.refs);
            const active = row.commit.hash === selectedHash;
            const refColor = laneColor(row.lane);

            return (
              <button
                className={`history-row ${active ? "active" : ""}`}
                key={row.commit.hash}
                type="button"
                onClick={() => onSelect(row.commit)}
                onDoubleClick={() => onDoubleClick(row.commit)}
              >
                <div className="col-graph" style={{ width: graphWidth }}>
                  <svg
                    className="graph-svg"
                    width={graphWidth}
                    height={36}
                    aria-hidden="true"
                  >
                    {Array.from({ length: row.laneCount }).map((_, laneIndex) => {
                      const color = laneColor(laneIndex);
                      const x = 12 + laneIndex * 14;
                      return (
                        <g key={laneIndex}>
                          {laneIndex === row.lane && row.continueDown ? (
                            <line x1={x} y1={18} x2={x} y2={36} stroke={color} strokeWidth={2} />
                          ) : null}
                          {laneIndex === row.lane ? (
                            <line x1={x} y1={0} x2={x} y2={18} stroke={color} strokeWidth={2} />
                          ) : null}
                        </g>
                      );
                    })}
                    <circle
                      cx={12 + row.lane * 14}
                      cy={18}
                      r={5}
                      fill={refColor}
                      stroke="white"
                      strokeWidth={2}
                    />
                  </svg>
                </div>

                <div className="col-branch">
                  {mainRef ? (
                    <span
                      className="branch-badge"
                      style={{
                        background: `${refColor}18`,
                        color: refColor,
                        borderColor: `${refColor}40`,
                      }}
                    >
                      {mainRef}
                    </span>
                  ) : refs[0] ? (
                    <span className="branch-badge muted">{refs[0]}</span>
                  ) : null}
                </div>

                <div className="col-message" title={row.commit.subject}>
                  {row.commit.subject}
                </div>
                <div className="col-hash">{row.commit.shortHash}</div>
                <div className="col-date">{formatCommitDate(row.commit.date)}</div>
                <div className="col-time">{formatCommitTime(row.commit.date)}</div>
                <div className="col-author">
                  <span className="author-avatar">{authorInitials(row.commit.author)}</span>
                  <span>{row.commit.author.split(" ")[0]}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
