export function splitFilePath(path: string): { name: string; directory: string } {
  const slash = path.lastIndexOf("/");
  if (slash === -1) {
    return { name: path, directory: "" };
  }
  return { name: path.slice(slash + 1), directory: path.slice(0, slash) };
}
