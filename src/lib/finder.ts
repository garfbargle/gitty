import { revealItemInDir } from "@tauri-apps/plugin-opener";

export function joinRepoPath(repoPath: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, "");
  return `${repoPath.replace(/\/+$/, "")}/${normalized}`;
}

export async function revealInFinder(path: string): Promise<void> {
  try {
    await revealItemInDir(path);
  } catch {
    // Finder may fail for missing paths; ignore quietly.
  }
}
