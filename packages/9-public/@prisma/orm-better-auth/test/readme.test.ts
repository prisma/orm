import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import { contractMessage } from '../src/contract/message';
import { useContractFixture } from './helpers/contract-fixture';
import { targets } from './helpers/databases';
import { compare, pslForConfiguration } from './helpers/printed-psl';

const fixture = useContractFixture();
const readme = () => readFile(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

function fencedBlock(text: string, opening: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(opening);
  if (start === -1) throw new Error(`The README has no block starting ${opening}`);
  const end = lines.indexOf('```', start + 1);
  if (end === -1) throw new Error(`The README block starting ${opening} has no closing fence`);
  return lines.slice(start + 1, end).join('\n');
}

describe('fencedBlock', () => {
  it('reads a block whose fences stand on their own lines', () => {
    expect(fencedBlock('Intro\n```prisma\nmodel A {}\n```\n', '```prisma')).toBe('model A {}');
  });

  it('ignores a fence that does not start its line', () => {
    expect(() => fencedBlock('Example: ```prisma\nmodel A {}\n```\n', '```prisma')).toThrow(
      'The README has no block starting ```prisma',
    );
  });

  it('ignores a closing fence that does not stand alone on its line', () => {
    expect(() => fencedBlock('```prisma\nmodel A {}\n```suffix\n', '```prisma')).toThrow(
      'The README block starting ```prisma has no closing fence',
    );
  });
});

describe('the README', () => {
  it.each(targets)(
    'shows the PSL the package prints for the default configuration on %s',
    async (target) => {
      expect(fencedBlock(await readme(), '```prisma')).toBe(
        pslForConfiguration(fixture().emptyContract(target), {}).trimEnd(),
      );
    },
  );

  it('shows the message the package gives for the two-factor plugin', async () => {
    const core = await fixture().contractOf(
      'sqlite',
      pslForConfiguration(fixture().emptyContract('sqlite'), {}),
    );
    const output = fencedBlock(await readme(), '```text');
    const message = output.slice(output.indexOf('\n') + 1);
    expect(message).toBe(contractMessage(compare(core, { plugins: [twoFactor()] })));
  });
});
