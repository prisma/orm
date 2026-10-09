import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { str } from '../src/attribute-spec/combinators/str';
import { optional } from '../src/attribute-spec/optional';
import { createBinder } from '../src/binder';
import { structBlock } from '../src/block-spec/constructors';
import type { PslBlockSpecDescriptor } from '../src/block-spec/descriptor';
import { interpretExtensionBlocks } from '../src/block-spec/interpret';
import type { BlockSpecContext } from '../src/block-spec/types';
import { parse } from '../src/parse';
import { buildSymbolTable } from '../src/symbol-table';
import { binderContext } from './support';

function dataTypeSupport(): DataTypeSupport {
  return { entries: {}, lookup: createDataTypeLookup([]) };
}

function recordingDescriptor(seen: { spec: BlockSpecContext[]; attribute: BlockSpecContext[] }) {
  return {
    kind: 'pslBlock',
    keyword: 'policy_select',
    discriminator: 'fixture-policy',
    name: { required: true },
    spec: (ctx: BlockSpecContext) => {
      seen.spec.push(ctx);
      return structBlock({
        parameters: { using: { type: optional(str()), documentation: 'The row predicate.' } },
      });
    },
    attributes: {
      map: (ctx: BlockSpecContext) => {
        seen.attribute.push(ctx);
        return blockAttribute('map', {
          documentation: 'Maps the policy.',
          positional: [{ key: 'name', type: str(), documentation: 'The policy name.' }],
        });
      },
    },
  } satisfies PslBlockSpecDescriptor;
}

const SOURCE = ['policy_select ReadPosts {', '  using = "true"', '  @@map("read")', '}'].join('\n');

describe('block spec context', () => {
  it('carries the data types the binder and the block interpreter are given', () => {
    const bound = { spec: [] as BlockSpecContext[], attribute: [] as BlockSpecContext[] };
    const interpreted = { spec: [] as BlockSpecContext[], attribute: [] as BlockSpecContext[] };
    const binderDataTypes = dataTypeSupport();
    const interpreterDataTypes = dataTypeSupport();
    const { document, sources } = parse(SOURCE, 'test.psl');
    const { symbolTable } = buildSymbolTable({ documents: [document], sources });

    const { binder } = createBinder({
      sources,
      symbolTable,
      context: binderContext({
        dataTypes: binderDataTypes,
        pslBlockDescriptors: { policy_select: recordingDescriptor(bound) },
      }),
    });
    const { diagnostics } = interpretExtensionBlocks({
      symbolTable,
      sources,
      pslBlockDescriptors: { policy_select: recordingDescriptor(interpreted) },
      binder,
      dataTypes: interpreterDataTypes,
    });

    expect(diagnostics).toEqual([]);
    const contexts = {
      bound: [...bound.spec, ...bound.attribute],
      interpreted: [...interpreted.spec, ...interpreted.attribute],
    };
    expect({
      bound: contexts.bound.map((ctx) => ctx.dataTypes === binderDataTypes),
      interpreted: contexts.interpreted.map((ctx) => ctx.dataTypes === interpreterDataTypes),
    }).toEqual({ bound: [true, true], interpreted: [true, true] });
  });
});
