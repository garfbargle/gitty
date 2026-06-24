import { splitFilePath } from "../lib/paths";

type FilePathLabelProps = {
  path: string;
  className?: string;
};

export function FilePathLabel({ path, className }: FilePathLabelProps) {
  const { name, directory } = splitFilePath(path);

  return (
    <span className={["file-path-label", className].filter(Boolean).join(" ")}>
      <span className="file-path-name">{name}</span>
      {directory ? <span className="file-path-dir">{directory}</span> : null}
    </span>
  );
}
