import { invoke } from "@tauri-apps/api/core";

export type RepoImage = {
  relativePath: string;
  dataUrl: string;
};

const iconCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
const subscribers = new Map<string, Set<() => void>>();

/** Notify mounted <RepoIcon> instances for a path that their icon changed. */
export function subscribeRepoIcon(path: string, listener: () => void): () => void {
  let listeners = subscribers.get(path);
  if (!listeners) {
    listeners = new Set();
    subscribers.set(path, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = subscribers.get(path);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(path);
  };
}

function notifyRepoIcon(path: string) {
  subscribers.get(path)?.forEach((listener) => listener());
}

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
  notifyRepoIcon(path);
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
  notifyRepoIcon(path);
}

/** List candidate images inside the repo for the manual icon picker. */
export async function listRepoImages(path: string): Promise<RepoImage[]> {
  return invoke<RepoImage[]>("list_repo_images", { path });
}

/** Pin a specific in-repo image as this repo's icon. */
export async function setRepoIcon(
  path: string,
  relativePath: string,
): Promise<string | null> {
  const dataUrl = await invoke<string | null>("set_repo_icon", { path, relativePath });
  invalidateRepoIcon(path);
  primeRepoIcon(path, dataUrl);
  return dataUrl;
}

/** Drop the manual override and return to automatic icon detection. */
export async function clearRepoIcon(path: string): Promise<string | null> {
  const dataUrl = await invoke<string | null>("clear_repo_icon", { path });
  invalidateRepoIcon(path);
  primeRepoIcon(path, dataUrl);
  return dataUrl;
}
