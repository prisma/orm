import type { Contract, ControlPolicy } from '@internal/contract/types';
import type {
  ControlFamilyDescriptor,
  ControlStack,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { createControlStack, hasPslContractBuild } from '@internal/framework-components/control';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it, vi } from 'vitest';
import { createSqlFamilyInstance } from '../src/core/control-instance';

const DOCUMENT: PslDocumentAst = {
  kind: 'document',
  sourceId: 'built',
  namespaces: [],
  span: {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  },
};

function stackWithBuilder(
  buildPslContract: ((contract: Contract<SqlStorage>) => PslDocumentAst) | undefined,
): ControlStack<'sql', 'postgres'> {
  return createControlStack({
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      create: (() => ({})) as unknown as ControlFamilyDescriptor<'sql'>['create'],
    } as unknown as ControlFamilyDescriptor<'sql'>,
    target: {
      kind: 'target',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: () => ({ familyId: 'sql', targetId: 'postgres' }),
      ...(buildPslContract === undefined ? {} : { buildPslContract }),
    } as ControlTargetDescriptor<'sql', 'postgres'>,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: 'sql',
      targetId: 'postgres',
      create: (() => ({ familyId: 'sql', targetId: 'postgres' })) as unknown as (
        stack: unknown,
      ) => never,
    },
    extensions: [],
  });
}

function contractWith(defaultControlPolicy?: ControlPolicy): Contract<SqlStorage> {
  return {
    target: 'postgres',
    ...(defaultControlPolicy === undefined ? {} : { defaultControlPolicy }),
  } as unknown as Contract<SqlStorage>;
}

describe('sql family buildPslContract', () => {
  it("returns the target's document and no source settings for a contract without a default control policy", () => {
    const builder = vi.fn(() => DOCUMENT);
    const instance = createSqlFamilyInstance(stackWithBuilder(builder));
    const contract = contractWith();

    expect(instance.buildPslContract(contract)).toEqual({ document: DOCUMENT, sourceSettings: {} });
    expect(builder).toHaveBeenCalledWith(contract, expect.anything());
  });

  it('passes the target hook the stack parts the PSL source reads with', () => {
    const builder = vi.fn(() => DOCUMENT);
    const stack = stackWithBuilder(builder);
    const contract = contractWith();

    createSqlFamilyInstance(stack).buildPslContract(contract);

    expect(builder).toHaveBeenCalledWith(contract, {
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypeLookup: stack.dataTypeLookup,
    });
  });

  it('returns the default control policy as a setting the PSL source must carry', () => {
    const instance = createSqlFamilyInstance(stackWithBuilder(() => DOCUMENT));

    expect(instance.buildPslContract(contractWith('external'))).toEqual({
      document: DOCUMENT,
      sourceSettings: { defaultControlPolicy: 'external' },
    });
  });

  it('passes the capability check contract print makes, even when the target has no hook', () => {
    expect(hasPslContractBuild(createSqlFamilyInstance(stackWithBuilder(undefined)))).toBe(true);
  });

  it('raises CONTRACT.PRINT_UNSUPPORTED when the target descriptor has no buildPslContract', () => {
    const instance = createSqlFamilyInstance(stackWithBuilder(undefined));

    expect(() => instance.buildPslContract(contractWith())).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        meta: { targetId: 'postgres' },
      }),
    );
  });
});
