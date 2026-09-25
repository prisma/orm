import type { JsonValue } from '@internal/contract/types';
import { describe, expectTypeOf, it } from 'vitest';
import { bool } from '../src/attribute-spec/combinators/bool';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { fieldRef, referencedFieldRef } from '../src/attribute-spec/combinators/field-ref';
import { identifier } from '../src/attribute-spec/combinators/identifier';
import { jsonValue } from '../src/attribute-spec/combinators/json-value';
import { list } from '../src/attribute-spec/combinators/list';
import { oneOf } from '../src/attribute-spec/combinators/one-of';
import { record } from '../src/attribute-spec/combinators/record';
import { str } from '../src/attribute-spec/combinators/str';
import { optional } from '../src/attribute-spec/optional';
import { entriesBlock, fixedBlock } from '../src/block-spec/binders';
import type { PslBlockSpecDescriptor } from '../src/block-spec/descriptor';
import type { interpretExtensionBlock } from '../src/block-spec/interpret';
import type { BlockSpecContext, BlockSpecFactory, InferBlock } from '../src/block-spec/types';
import type { ResolvedEntityReference } from '../src/entity-reference';
import type { BlockSymbol, ModelSymbol } from '../src/symbol-table';

function policySpec() {
  return fixedBlock({
    parameters: {
      target: { type: entityRef({ kind: 'model' }), documentation: 'The protected model.' },
      using: { type: str(), documentation: 'The row predicate.' },
      permissive: {
        type: optional(bool(), true),
        documentation: 'Whether the policy is permissive.',
      },
      roles: {
        type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
        documentation: 'Database roles.',
      },
    },
  });
}

describe('InferBlock', () => {
  it('infers required, optional, and reference-valued fixed properties from a realistic spec', () => {
    type Out = InferBlock<ReturnType<typeof policySpec>>;

    expectTypeOf<Out['target']>().toEqualTypeOf<ResolvedEntityReference<ModelSymbol>>();
    expectTypeOf<Out['using']>().toEqualTypeOf<string>();
    expectTypeOf<Out>().toMatchTypeOf<{
      readonly target: ResolvedEntityReference<ModelSymbol>;
      readonly using: string;
    }>();
    expectTypeOf<Out['permissive']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Out['roles']>().toEqualTypeOf<
      (ResolvedEntityReference<BlockSymbol> | string)[] | undefined
    >();
    expectTypeOf<{ target: Out['target']; using: Out['using'] }>().toMatchTypeOf<
      Pick<Out, 'target' | 'using'>
    >();
  });

  it('keeps optional keys optional and required keys required', () => {
    type Out = InferBlock<ReturnType<typeof policySpec>>;
    const complete: Out = {
      target: {} as ResolvedEntityReference<ModelSymbol>,
      using: 'true',
    };
    void complete;
    // @ts-expect-error using is required
    const missingRequired: Out = { target: {} as ResolvedEntityReference<ModelSymbol> };
    void missingRequired;
  });

  it('infers a record of the entry rule output for arbitrary-key blocks', () => {
    const explicitOnly = entriesBlock({
      value: { type: str(), documentation: 'The explicit member value.' },
    });
    expectTypeOf<InferBlock<typeof explicitOnly>>().toEqualTypeOf<Record<string, string>>();

    const withBare = entriesBlock({
      value: { type: jsonValue(), documentation: 'The explicit member value.' },
      allowBare: true,
    });
    expectTypeOf<InferBlock<typeof withBare>>().toEqualTypeOf<
      Record<string, JsonValue | undefined>
    >();
  });

  it('supports nested shared rules', () => {
    const spec = fixedBlock({
      parameters: {
        weights: {
          type: optional(record(list(str()))),
          documentation: 'Named string lists.',
        },
      },
    });
    expectTypeOf<InferBlock<typeof spec>>().toEqualTypeOf<{
      readonly weights?: Record<string, string[]>;
    }>();
  });
});

describe('block spec context requirements', () => {
  it('rejects model- and field-context rules inside block specs', () => {
    fixedBlock({
      parameters: {
        // @ts-expect-error model-only rules cannot enter block specs
        broken: { type: fieldRef(), documentation: 'Needs a model context.' },
      },
    });
    fixedBlock({
      parameters: {
        // @ts-expect-error field-only rules cannot enter block specs
        broken: { type: referencedFieldRef(), documentation: 'Needs a field context.' },
      },
    });
    entriesBlock({
      // @ts-expect-error model-only rules cannot enter block specs
      value: { type: fieldRef(), documentation: 'Needs a model context.' },
    });
  });
});

describe('interpretExtensionBlock inference', () => {
  it('returns the spec-inferred envelope for the concrete spec', () => {
    type Result = ReturnType<typeof interpretExtensionBlock<ReturnType<typeof policySpec>>>;
    type Envelope = Extract<Result, { readonly ok: true }>['value'];
    expectTypeOf<Envelope['values']>().toEqualTypeOf<InferBlock<ReturnType<typeof policySpec>>>();
  });
});

describe('PslBlockSpecDescriptor', () => {
  it('narrows the erased core spec to the parser factory for authoring', () => {
    const descriptor = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'fixture-policy',
      name: { required: true },
      spec: policySpec,
    } satisfies PslBlockSpecDescriptor;
    expectTypeOf(descriptor.spec).toMatchTypeOf<BlockSpecFactory>();

    const withContext = {
      ...descriptor,
      spec: (ctx: BlockSpecContext) => {
        expectTypeOf(ctx.block).toEqualTypeOf<BlockSymbol>();
        return policySpec();
      },
    } satisfies PslBlockSpecDescriptor;
    void withContext;
  });

  it('rejects a non-factory spec', () => {
    const broken = {
      kind: 'pslBlock',
      keyword: 'policy_select',
      discriminator: 'fixture-policy',
      name: { required: true },
      // @ts-expect-error the parser-facing descriptor requires a spec factory
      spec: 'not-a-factory',
    } satisfies PslBlockSpecDescriptor;
    void broken;
  });
});
