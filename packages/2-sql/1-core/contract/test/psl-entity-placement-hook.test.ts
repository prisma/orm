import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ResolvedPslModelRefs,
  SqlPslEntityPlacementOutput,
} from '../src/entity-handle-lowering-hook';
import { providesPslEntityPlacement } from '../src/entity-handle-lowering-hook';

describe('providesPslEntityPlacement', () => {
  it('accepts an output carrying a callable pslPlacement', () => {
    const output = {
      factory: () => ({}),
      pslPlacement: (entity: { readonly namespaceId: string }) => ({
        namespaceId: entity.namespaceId,
      }),
    };

    expect(providesPslEntityPlacement(output)).toBe(true);
    if (!providesPslEntityPlacement(output)) return;
    expect(output.pslPlacement({ namespaceId: 'audit' })).toEqual({ namespaceId: 'audit' });
  });

  it('rejects outputs without the hook or with a non-callable property', () => {
    expect(providesPslEntityPlacement({ factory: () => ({}) })).toBe(false);
    expect(providesPslEntityPlacement({ pslPlacement: 'schema' })).toBe(false);
    expect(providesPslEntityPlacement(null)).toBe(false);
    expect(providesPslEntityPlacement(undefined)).toBe(false);
    expect(providesPslEntityPlacement('pslPlacement')).toBe(false);
  });

  it('stays structurally compatible with a concretely typed pack implementation', () => {
    interface FixturePolicy {
      readonly namespaceId: string;
      readonly tableName: string;
    }
    const output = {
      pslPlacement: (entity: FixturePolicy) => ({ namespaceId: entity.namespaceId }),
    } satisfies SqlPslEntityPlacementOutput;
    expectTypeOf(output).toMatchTypeOf<SqlPslEntityPlacementOutput>();
  });
});

describe('ResolvedPslModelRefs', () => {
  it('carries the full storage coordinate per resolved parameter', () => {
    const refs = {
      target: { namespaceId: 'public', tableName: 'root_widgets' },
    } satisfies ResolvedPslModelRefs;
    expectTypeOf(refs['target']).toMatchTypeOf<
      { readonly namespaceId: string; readonly tableName: string } | undefined
    >();
    // @ts-expect-error a table name alone is no longer a complete coordinate
    const incomplete = { target: { tableName: 'root_widgets' } } satisfies ResolvedPslModelRefs;
    void incomplete;
  });
});
