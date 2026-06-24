import { useEffect, useState } from "react";
import { fetchRepoIcon, repoIconFallbackColor, repoIconInitial } from "../lib/repoIcons";

type RepoIconProps = {
  path: string;
  name: string;
  size?: number;
  className?: string;
};

export function RepoIcon({ path, name, size = 16, className = "" }: RepoIconProps) {
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void fetchRepoIcon(path).then((url) => {
      if (active) setDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [path]);

  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt=""
        aria-hidden="true"
        className={`repo-icon-img ${className}`.trim()}
        width={size}
        height={size}
        draggable={false}
      />
    );
  }

  if (dataUrl === undefined) {
    return (
      <span
        className={`repo-icon-fallback loading ${className}`.trim()}
        style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.52)) }}
        aria-hidden="true"
      >
        {repoIconInitial(name)}
      </span>
    );
  }

  return (
    <span
      className={`repo-icon-fallback ${className}`.trim()}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.52)),
        background: repoIconFallbackColor(name),
      }}
      aria-hidden="true"
      title={name}
    >
      {repoIconInitial(name)}
    </span>
  );
}
