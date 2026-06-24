export type RepoEntry = {
  id: string;
  name: string;
  path: string;
};

export type CommitEntry = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string;
  subject: string;
};

export type FileChange = {
  status: string;
  path: string;
  oldPath?: string | null;
};

export type RemoteEntry = {
  name: string;
  url: string;
  kind: string;
};

export type BranchEntry = {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream?: string | null;
};

export type RepoSnapshot = {
  repo: RepoEntry;
  branch: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  changes: FileChange[];
  commits: CommitEntry[];
  remotes: RemoteEntry[];
  branches: BranchEntry[];
};

export type ActionResult = {
  message: string;
  output: string;
};

export type DiffFocus =
  | { kind: "commit"; commit: CommitEntry }
  | { kind: "file"; file: FileChange }
  | null;
