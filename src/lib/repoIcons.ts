import { invoke } from "@tauri-apps/api/core";

const iconCache = new Map<string, string | null>();
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

export async function fetchRepoIcon(path: string): Promise<string | null> {
  if (iconCache.has(path)) {
    return iconCache.get(path) ?? null;
  }

  const pending = inflight.get(path);
  if (pending) return pending;

  const task = invoke<string | null>("resolve_repo_icon", { path })
    .then((dataUrl) => {
      iconCache.set(path, dataUrl);
      inflight.delete(path);
      return dataUrl;
    })
    .catch(() => {
      iconCache.set(path, null);
      inflight.delete(path);
      return null;
    });

  inflight.set(path, task);
  return task;
}

export function primeRepoIcon(path: string, dataUrl: string | null) {
  iconCache.set(path, dataUrl);
}
