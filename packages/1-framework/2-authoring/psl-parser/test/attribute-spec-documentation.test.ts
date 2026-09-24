import { describe, expect, it } from 'vitest';
import {
  blockAttribute,
  fieldAttribute,
  funcCall,
  int,
  interpretAttribute,
  modelAttribute,
  optional,
  str,
} from '../src/exports';
import { Cursor, parseAttribute } from '../src/parse';
import { PslSources } from '../src/source-file';
import { ModelAttributeAst } from '../src/syntax/ast/attributes';
import { createSyntaxTree } from '../src/syntax/red';

describe('declaration documentation', () => {
  it.each([
    () => blockAttribute('marker', { documentation: 'Marks this declaration.' }),
    () => modelAttribute('marker', { documentation: 'Marks this declaration.' }),
    () => fieldAttribute('marker', { documentation: 'Marks this declaration.' }),
  ])('retains attribute documentation', (attribute) => {
    const spec = attribute();
    expect(spec.documentation).toBe('Marks this declaration.');
  });

  it('keeps declaration-specific documentation separate from reusable types', () => {
    const type = str();
    const spec = blockAttribute('pair', {
      documentation: 'A pair of names.',
      positional: [{ key: 'first', type, documentation: 'The first name.' }],
      named: { second: { type, documentation: 'The second name.' } },
    });
    expect(spec.positional[0]).toEqual({ key: 'first', type, documentation: 'The first name.' });
    expect(spec.named['second']).toEqual({ type, documentation: 'The second name.' });
    expect(type).not.toHaveProperty('documentation');
  });

  it.each([
    ['generate()', { size: 12, prefix: 'usr', explicit: undefined }],
    ['generate(prefix: "custom")', { size: 12, prefix: 'custom', explicit: undefined }],
    ['generate(20, prefix: "custom")', { size: 20, prefix: 'custom', explicit: undefined }],
  ])('interprets documented nested parameters in %s without leaking metadata', (source, args) => {
    const call = funcCall('generate', {
      documentation: 'Generates a value.',
      positional: [{ key: 'size', type: optional(int(), 12), documentation: 'Output size.' }],
      named: {
        prefix: { type: optional(str(), 'usr'), documentation: 'Output prefix.' },
        absent: { type: optional(str()), documentation: 'An omitted value.' },
        explicit: {
          type: optional(str(), undefined),
          documentation: 'Explicit undefined default.',
        },
      },
    });
    const spec = blockAttribute('default', {
      documentation: 'Sets the default.',
      positional: [{ key: 'value', type: call, documentation: 'The default expression.' }],
    });
    const cursor = new Cursor('schema.prisma', `@@default(${source})`);
    const root = createSyntaxTree(parseAttribute(cursor));
    const node = ModelAttributeAst.cast(root);
    if (!node) throw new Error('expected a block attribute');
    const result = interpretAttribute(node, spec, {
      sources: new PslSources([[root, cursor.sourceFile]]),
      symbols: {
        topLevel: { namespaces: {}, models: {}, compositeTypes: {}, namedTypes: {}, blocks: {} },
      },
    });
    expect(result.assertOk()).toStrictEqual({
      value: {
        fn: 'generate',
        span: expect.any(Object),
        args,
      },
    });
    expect(call.signature.documentation).toBe('Generates a value.');
    expect(call.signature.named.prefix.documentation).toBe('Output prefix.');
  });
});
