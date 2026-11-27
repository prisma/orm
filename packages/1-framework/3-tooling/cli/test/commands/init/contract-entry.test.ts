import { describe, expect, it } from 'vitest';
import { contractEntryFor } from '../../../src/commands/init/contract-entry';
import type {
  ContractEntryNode,
  InitContribution,
} from '../../../src/commands/init/init-contribution';
import { STUB_CONTRIBUTION, STUB_PACKAGE } from '../../orm/init-prisma7-fixtures';

const owner = { packageName: STUB_PACKAGE, unlisted: true };
const PSL_CONTRACT = { kind: 'starter', mode: 'psl', path: './prisma/contract.prisma' } as const;

function withEntry(contractEntry: (...args: unknown[]) => unknown): InitContribution {
  return Object.assign({}, STUB_CONTRIBUTION, { contractEntry });
}

function rendered(entry: Pick<ContractEntryNode, 'renderTypeScript' | 'importRequirements'>) {
  return { source: entry.renderTypeScript(), imports: entry.importRequirements() };
}

describe('contractEntryFor', () => {
  describe('a contribution without contractEntry', () => {
    it('gets the contract path', () => {
      expect(rendered(contractEntryFor(STUB_CONTRIBUTION, PSL_CONTRACT, owner))).toEqual({
        source: '"./prisma/contract.prisma"',
        imports: [],
      });
    });

    it('gets a call of prisma7Schema from its config module with the schema path', () => {
      expect(
        rendered(
          contractEntryFor(
            STUB_CONTRIBUTION,
            { kind: 'prisma7-schema', path: 'prisma/schema.prisma' },
            owner,
          ),
        ),
      ).toEqual({
        source: 'prisma7Schema("prisma/schema.prisma")',
        imports: [{ moduleSpecifier: `${STUB_PACKAGE}/config`, symbol: 'prisma7Schema' }],
      });
    });
  });

  it('passes the contract source to the contribution and keeps the node it returns, whatever its class', () => {
    const inputs: unknown[] = [];
    const node: ContractEntryNode = {
      renderTypeScript: () => 'stubContract("./x")',
      importRequirements: () => [{ moduleSpecifier: 'stub/config', symbol: 'stubContract' }],
      contractValue: () => './x',
    };
    const contribution = withEntry((...args) => {
      inputs.push(...args);
      return node;
    });

    expect(contractEntryFor(contribution, PSL_CONTRACT, owner)).toBe(node);
    expect(inputs).toEqual([PSL_CONTRACT]);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['a bare string', './prisma/contract.prisma'],
    ['the removed value form', { value: './prisma/contract.prisma' }],
    [
      'a node without contractValue',
      { renderTypeScript: () => '"./x"', importRequirements: () => [] },
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
          `The default export of \`${STUB_PACKAGE}/init\` is not an init contribution: its contractEntry returned no contract entry node with the methods renderTypeScript, importRequirements, contractValue`,
        ),
      }),
    );
  });
});
