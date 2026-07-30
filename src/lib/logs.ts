/** Format timestamps consistently across Git and terminal activity output. */
export function formatLogTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

/** Prefix every output line with the time it was added to the activity log. */
export function timestampLogOutput(output: string, timestamp = Date.now()): string {
  if (!output) return "";
  const prefix = `[${formatLogTimestamp(timestamp)}]`;
  return output
    .split("\n")
    .map((line) => `${prefix} ${line}`)
    .join("\n");
}
