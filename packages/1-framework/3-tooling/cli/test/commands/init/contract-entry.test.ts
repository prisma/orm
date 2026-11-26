import { describe, expect, it } from 'vitest';
import { contractEntryFor } from '../../../src/commands/init/contract-entry';
import type { InitContribution } from '../../../src/commands/init/init-contribution';
import { STUB_CONTRIBUTION, STUB_PACKAGE } from '../../orm/init-prisma7-fixtures';

const owner = { packageName: STUB_PACKAGE, unlisted: true };
const PSL_CONTRACT = { kind: 'contract', mode: 'psl', path: './prisma/contract.prisma' } as const;

function withEntry(contractEntry: (...args: unknown[]) => unknown): InitContribution {
  return Object.assign({}, STUB_CONTRIBUTION, { contractEntry });
}

describe('contractEntryFor', () => {
  describe('a contribution without contractEntry', () => {
    it('gets the contract path as a value', () => {
      expect(contractEntryFor(STUB_CONTRIBUTION, PSL_CONTRACT, owner)).toEqual({
        value: './prisma/contract.prisma',
      });
    });

    it('gets a call of prisma7Schema from its config module with the schema path', () => {
      expect(
        contractEntryFor(
          STUB_CONTRIBUTION,
          { kind: 'prisma7-schema', path: 'prisma/schema.prisma' },
          owner,
        ),
      ).toEqual({
        call: {
          module: `${STUB_PACKAGE}/config`,
          export: 'prisma7Schema',
          args: ['prisma/schema.prisma'],
        },
      });
    });
  });

  it('passes the contract source to the contribution and keeps what it returns', () => {
    const inputs: unknown[] = [];
    const entry = {
      call: { module: 'stub/config', export: 'stubContract', args: ['./x', { level: 3 }, null] },
    };
    const contribution = withEntry((...args) => {
      inputs.push(...args);
      return entry;
    });

    expect(contractEntryFor(contribution, PSL_CONTRACT, owner)).toEqual(entry);
    expect(inputs).toEqual([PSL_CONTRACT]);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['a bare string', './prisma/contract.prisma'],
    ['both a value and a call', { value: 'x', call: { module: 'm', export: 'f', args: [] } }],
    ['a value that is not JSON', { value: { path: './x', at: new Date(0) } }],
    ['a value that is undefined', { value: undefined }],
    ['a value holding a number that is not finite', { value: Number.NaN }],
    ['a call without a module', { call: { export: 'f', args: [] } }],
    [
      'a call of a name that is not an identifier',
      { call: { module: 'm', export: 'a-b', args: [] } },
    ],
    ['a call whose arguments are not a list', { call: { module: 'm', export: 'f', args: 'x' } }],
    ['a call with a function argument', { call: { module: 'm', export: 'f', args: [() => 1] } }],
  ])('refuses a contractEntry that returns %s', (_case, returned) => {
    expect(() =>
      contractEntryFor(
        withEntry(() => returned),
        PSL_CONTRACT,
        owner,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
        why: expect.stringContaining(
          `The default export of \`${STUB_PACKAGE}/init\` is not an init contribution: its contractEntry returned`,
        ),
      }),
    );
  });
});
