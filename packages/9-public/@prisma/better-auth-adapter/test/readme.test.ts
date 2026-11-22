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
  const start = text.indexOf(opening);
  if (start === -1) throw new Error(`The README has no block starting ${opening}`);
  const body = text.indexOf('\n', start) + 1;
  return text.slice(body, text.indexOf('\n```', body));
}

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
