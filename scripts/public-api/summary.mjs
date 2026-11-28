// The job summaries of the checks against the last release. GitHub drops a step's whole summary
// when it is over 1 MiB, so a summary is cut to a size below that, and says where the rest is.

export const SUMMARY_BYTES = 1_000_000;
const REST = 'The rest is in the job log.';

// The lines of a Markdown summary, as text of at most `maxBytes` bytes. A code block cut short is
// closed.
export function withinBytes(lines, maxBytes = SUMMARY_BYTES) {
  const whole = `${lines.join('\n')}\n`;
  if (Buffer.byteLength(whole) <= maxBytes) return whole;
  const kept = [];
  let open = false;
  let size = Buffer.byteLength(`\n\`\`\`\n\n${REST}\n`);
  for (const line of lines) {
    const bytes = Buffer.byteLength(line) + 1;
    if (size + bytes > maxBytes) break;
    kept.push(line);
    size += bytes;
    if (line.startsWith('```')) open = !open;
  }
  if (open) kept.push('```');
  return `${[...kept, '', REST].join('\n')}\n`;
}
