// A JSON code block whose fence is longer than any run of backticks inside it, so model text can
// never break the Markdown of the eval report.
export function fenced(value: unknown): string[] {
  const json = JSON.stringify(value, null, 2);
  const longestRun = Math.max(0, ...(json.match(/`+/g) ?? []).map((s) => s.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [`${fence}json`, json, fence, ""];
}
