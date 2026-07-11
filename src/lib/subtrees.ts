import { invoke } from "@tauri-apps/api/core";
import type { ActionResult, LinkedFolder, SubtreeUpdateStatus, UpdateOutcome } from "../types";

/// List this repo's linked folders (git subtrees). Local-only and instant.
export function listLinkedFolders(path: string) {
  return invoke<LinkedFolder[]>("list_linked_folders", { path });
}

/// Check each linked folder against its source ref's tip (one `ls-remote` per
/// folder, no fetch). Network-bound — call on demand, not on every render.
export function checkSubtreeUpdates(path: string) {
  return invoke<SubtreeUpdateStatus[]>("check_subtree_updates", { path });
}

/// Add a folder that mirrors another repo, recording its origin in the manifest.
export function addLinkedFolder(path: string, prefix: string, url: string, branch: string) {
  return invoke<ActionResult>("add_linked_folder", { path, prefix, url, branch });
}

/// Pull the source's latest work into a linked folder. Conflicts come back as an
/// `UpdateOutcome` with `status: "conflicts"`, handled by the shared resolver.
export function updateLinkedFolder(path: string, prefix: string) {
  return invoke<UpdateOutcome>("update_linked_folder", { path, prefix });
}

/// Publish a linked folder's committed changes back to its source repo
/// (`git subtree push`). Rejects (source moved on) and uncommitted-edit guards
/// come back as a thrown error string.
export function pushLinkedFolder(path: string, prefix: string) {
  return invoke<ActionResult>("push_linked_folder", { path, prefix });
}

/// Record a linked folder's source when Gitty couldn't infer it from remotes.
export function setLinkedFolderSource(path: string, prefix: string, url: string, branch: string) {
  return invoke<ActionResult>("set_linked_folder_source", { path, prefix, url, branch });
}

/// Stop tracking a linked folder; `deleteFiles` also stages its removal.
export function removeLinkedFolder(path: string, prefix: string, deleteFiles: boolean) {
  return invoke<ActionResult>("remove_linked_folder", { path, prefix, deleteFiles });
}
