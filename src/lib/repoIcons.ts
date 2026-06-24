import { invoke } from "@tauri-apps/api/core";

const iconCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function repoIconFallbackColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 42% 38%)`;
}

export function repoIconInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = trimmed.replace(/^[\W_]+/, "").charAt(0);
  return (first || trimmed.charAt(0)).toUpperCase();
}

export function invalidateRepoIcon(path: string) {
  iconCache.delete(path);
  inflight.delete(path);
}

export async function fetchRepoIcon(
  path: string,
  options?: { force?: boolean },
): Promise<string | null> {
  const force = options?.force ?? false;

  if (!force && iconCache.has(path)) {
    return iconCache.get(path) ?? null;
  }

  const cacheKey = force ? `${path}:force:${Date.now()}` : path;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const task = invoke<string | null>("resolve_repo_icon", { path, forceRescan: force })
    .then((dataUrl) => {
      inflight.delete(cacheKey);
      if (dataUrl) {
        iconCache.set(path, dataUrl);
      } else {
        iconCache.delete(path);
      }
      return dataUrl;
    })
    .catch(() => {
      inflight.delete(cacheKey);
      iconCache.delete(path);
      return null;
    });

  inflight.set(cacheKey, task);
  return task;
}

export function primeRepoIcon(path: string, dataUrl: string | null) {
  if (dataUrl) iconCache.set(path, dataUrl);
  else iconCache.delete(path);
}
