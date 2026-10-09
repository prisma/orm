import type { ContractSourceContext } from '@internal/config/config-types';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import type { BlockSpecContext, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, optional, str, structBlock } from '@internal/psl-parser';
import { hasPslInterpreter } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { describe, expect, it } from 'vitest';
import { mongoContract } from '../src/exports/provider';

const SCHEMA = `// use prisma-8
audit_rule Reads {
  note = "reads"
  @@map("reads")
}
`;

function recordingDescriptor(seen: BlockSpecContext[]) {
  return {
    kind: 'pslBlock',
    keyword: 'audit_rule',
    discriminator: 'audit_rule',
    name: { required: true },
    spec: (ctx: BlockSpecContext) => {
      seen.push(ctx);
      return structBlock({
        parameters: { note: { type: optional(str()), documentation: 'A note.' } },
      });
    },
    attributes: {
      map: (ctx: BlockSpecContext) => {
        seen.push(ctx);
        return blockAttribute('map', {
          documentation: 'Maps the rule.',
          positional: [{ key: 'name', type: str(), documentation: 'The rule name.' }],
        });
      },
    },
  } satisfies PslBlockSpecDescriptor;
}

function mongoContext(seen: BlockSpecContext[]): ContractSourceContext {
  return {
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: {
      dataTypes: {},
      field: {},
      type: {},
      entityTypes: {
        audit_rule: {
          kind: 'entity',
          discriminator: 'audit_rule',
          output: { factory: (raw: unknown) => raw },
        },
      },
      pslBlockDescriptors: { audit_rule: recordingDescriptor(seen) },
      modelAttributes: {},
      attributeSpecs: { model: {}, field: {} },
    },
    dataTypes: { entries: {}, lookup: createDataTypeLookup([]) },
    codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
    controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
    resolvedInputs: [],
    capabilities: {},
  };
}

describe('block spec context', () => {
  it("receives the stack's data types through the Mongo provider", () => {
    const seen: BlockSpecContext[] = [];
    const context = mongoContext(seen);
    const source = mongoContract('./schema.prisma').source;
    if (!hasPslInterpreter(source)) throw new Error('expected an interpret-capable source');
    source.interpret(bindPslSchema(SCHEMA, { sourceId: './schema.prisma', context }), context);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((ctx) => ctx.dataTypes !== context.dataTypes)).toEqual([]);
  });
});
