import { describe, expect, it } from 'vitest';
import { contractEntryFor } from '../../../src/commands/init/contract-entry';
import type { InitContribution } from '../../../src/commands/init/init-contribution';
import { STUB_CONTRIBUTION, STUB_PACKAGE } from '../../orm/init-prisma7-fixtures';

const owner = { packageName: STUB_PACKAGE, unlisted: true };
const PSL_CONTRACT = { kind: 'starter', mode: 'psl', path: './prisma/contract.prisma' } as const;

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
          moduleSpecifier: `${STUB_PACKAGE}/config`,
          symbol: 'prisma7Schema',
          args: ['prisma/schema.prisma'],
        },
      });
    });
  });

  it('passes the contract source to the contribution and keeps what it returns', () => {
    const inputs: unknown[] = [];
    const entry = {
      call: {
        moduleSpecifier: 'stub/config',
        symbol: 'stubContract',
        args: ['./x', { level: 3 }, null],
      },
    };
    const contribution = withEntry((...args) => {
      inputs.push(...args);
      return entry;
    });

    expect(contractEntryFor(contribution, PSL_CONTRACT, owner)).toEqual(entry);
    expect(inputs).toEqual([PSL_CONTRACT]);
  });

  it('accepts a call of a name the config imports from the same module', () => {
    const entry = {
      call: { moduleSpecifier: '@prisma/cli-engine', symbol: 'definePrismaConfig', args: [] },
    };

    expect(
      contractEntryFor(
        withEntry(() => entry),
        PSL_CONTRACT,
        owner,
      ),
    ).toEqual(entry);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['a bare string', './prisma/contract.prisma'],
    [
      'both a value and a call',
      { value: 'x', call: { moduleSpecifier: 'm', symbol: 'f', args: [] } },
    ],
    ['a value that is not JSON', { value: { path: './x', at: new Date(0) } }],
    ['a value that is undefined', { value: undefined }],
    ['a value holding a number that is not finite', { value: Number.NaN }],
    ['a call without a module specifier', { call: { symbol: 'f', args: [] } }],
    [
      'a call of a name that is not an identifier',
      { call: { moduleSpecifier: 'm', symbol: 'a-b', args: [] } },
    ],
    [
      'a call whose arguments are not a list',
      { call: { moduleSpecifier: 'm', symbol: 'f', args: 'x' } },
    ],
    [
      'a call with a function argument',
      { call: { moduleSpecifier: 'm', symbol: 'f', args: [() => 1] } },
    ],
    ['a value with an undefined property', { value: { path: './x', databaseVersion: undefined } }],
    [
      'a call with an extra key',
      { call: { moduleSpecifier: 'm', symbol: 'f', args: [], alias: 'g' } },
    ],
    [
      'a call from an empty module specifier',
      { call: { moduleSpecifier: '', symbol: 'f', args: [] } },
    ],
    [
      'a call from a blank module specifier',
      { call: { moduleSpecifier: ' ', symbol: 'f', args: [] } },
    ],
    [
      'a call from a module specifier with a line break',
      { call: { moduleSpecifier: 'stub/con\nfig', symbol: 'f', args: [] } },
    ],
    [
      'a call from a module specifier with a control character',
      { call: { moduleSpecifier: 'stub/\u0007config', symbol: 'f', args: [] } },
    ],
    ['a call of a reserved word', { call: { moduleSpecifier: 'm', symbol: 'default', args: [] } }],
    [
      'a call of a strict-mode reserved word',
      { call: { moduleSpecifier: 'm', symbol: 'let', args: [] } },
    ],
    [
      'a call of ormConfig, which the config binds to defineConfig',
      { call: { moduleSpecifier: `${STUB_PACKAGE}/config`, symbol: 'ormConfig', args: [] } },
    ],
    [
      'a call of definePrismaConfig from another module',
      { call: { moduleSpecifier: 'm', symbol: 'definePrismaConfig', args: [] } },
    ],
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
