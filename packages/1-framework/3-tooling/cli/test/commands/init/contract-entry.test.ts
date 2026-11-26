import { describe, expect, it } from 'vitest';
import { contractEntryFor } from '../../../src/commands/init/contract-entry';
import type { InitContribution } from '../../../src/commands/init/init-contribution';
import { unlistedTargetPackage } from '../../../src/commands/init/target-packages';
import { STUB_CONTRIBUTION, STUB_PACKAGE } from '../../orm/init-prisma7-fixtures';

const target = unlistedTargetPackage(STUB_PACKAGE);

function rendered(contribution: InitContribution, input: Parameters<typeof contractEntryFor>[1]) {
  const expression = contractEntryFor(contribution, input, target);
  return {
    source: expression.renderTypeScript(),
    imports: expression.importRequirements(),
  };
}

function withEntry(contractEntry: () => unknown): InitContribution {
  return Object.assign({}, STUB_CONTRIBUTION, { contractEntry });
}

describe('contractEntryFor', () => {
  describe('a contribution without contractEntry', () => {
    it('gets the contract path as a string', () => {
      expect(
        rendered(STUB_CONTRIBUTION, {
          kind: 'contract',
          mode: 'psl',
          path: './prisma/contract.prisma',
        }),
      ).toEqual({ source: '"./prisma/contract.prisma"', imports: [] });
    });

    it('gets prisma7Schema(<path>) imported from its config module', () => {
      expect(
        rendered(STUB_CONTRIBUTION, { kind: 'prisma7-schema', path: 'prisma/schema.prisma' }),
      ).toEqual({
        source: 'prisma7Schema("prisma/schema.prisma")',
        imports: [{ moduleSpecifier: `${STUB_PACKAGE}/config`, symbol: 'prisma7Schema' }],
      });
    });
  });

  it('passes the contract source to the contribution and keeps what it returns', () => {
    const inputs: unknown[] = [];
    const contribution = withEntry((...args: unknown[]) => {
      inputs.push(...args);
      return {
        renderTypeScript: () => "stubContract('./prisma/contract.prisma')",
        importRequirements: () => [{ moduleSpecifier: 'stub/config', symbol: 'stubContract' }],
      };
    });

    expect(
      rendered(contribution, { kind: 'contract', mode: 'psl', path: './prisma/contract.prisma' }),
    ).toEqual({
      source: "stubContract('./prisma/contract.prisma')",
      imports: [{ moduleSpecifier: 'stub/config', symbol: 'stubContract' }],
    });
    expect(inputs).toEqual([{ kind: 'contract', mode: 'psl', path: './prisma/contract.prisma' }]);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['a string', '"./prisma/contract.prisma"'],
    ['an object without importRequirements', { renderTypeScript: () => '"x"' }],
    [
      'a renderTypeScript that returns no text',
      {
        renderTypeScript: () => '',
        importRequirements: () => [],
      },
    ],
    [
      'importRequirements that are not a list',
      {
        renderTypeScript: () => '"x"',
        importRequirements: () => 'stub/config',
      },
    ],
    [
      'an import requirement without a symbol',
      {
        renderTypeScript: () => '"x"',
        importRequirements: () => [{ moduleSpecifier: 'stub/config' }],
      },
    ],
  ])('refuses a contractEntry that returns %s', (_case, returned) => {
    expect(() =>
      contractEntryFor(
        withEntry(() => returned),
        { kind: 'contract', mode: 'psl', path: './prisma/contract.prisma' },
        target,
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
