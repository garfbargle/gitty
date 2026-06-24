import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchRepoIcon,
  invalidateRepoIcon,
  repoIconFallbackColor,
  repoIconInitial,
} from "../lib/repoIcons";

type RepoIconProps = {
  path: string;
  name: string;
  size?: number;
  className?: string;
};

export function RepoIcon({ path, name, size = 16, className = "" }: RepoIconProps) {
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined);
  const retriedRef = useRef(false);

  const loadIcon = useCallback(
    async (force = false) => {
      const url = await fetchRepoIcon(path, { force });
      setDataUrl(url);
    },
    [path],
  );

  useEffect(() => {
    retriedRef.current = false;
    setDataUrl(undefined);
    void loadIcon(false);
  }, [loadIcon]);

  function handleImageError() {
    if (retriedRef.current) {
      setDataUrl(null);
      return;
    }

    retriedRef.current = true;
    invalidateRepoIcon(path);
    void loadIcon(true);
  }

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
        onError={handleImageError}
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
