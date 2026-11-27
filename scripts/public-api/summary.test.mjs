import { strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withinBytes } from './summary.mjs';

describe('withinBytes', () => {
  it('keeps a summary that fits whole', () => {
    strictEqual(withinBytes(['a', 'b'], 100), 'a\nb\n');
  });

  it('closes a code block it cuts, and says where the rest is', () => {
    const lines = ['# Records', '```json', 'x'.repeat(40), 'y'.repeat(40), '```', 'after'];
    strictEqual(
      withinBytes(lines, 100),
      `# Records\n\`\`\`json\n${'x'.repeat(40)}\n\`\`\`\n\nThe rest is in the job log.\n`,
    );
  });
});
