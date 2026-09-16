import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';
import { classifyPslSignatureContext } from '../src/signature-context';

function input(args: string) {
  const source = `model Example { value String @relation(${args}) }`;
  const offset = source.indexOf('|');
  const { document, sourceFile } = parse(source.replace('|', ''));
  return { document, sourceFile, position: sourceFile.positionAt(offset) };
}

describe('attribute cursor interpretation', () => {
  it.each(['| ', ' | '])(
    'completes an insertion slot but selects the next signature parameter: %s',
    (gap) => {
      const cursor = input(`fields: [id],${gap}references: [id]`);
      expect(classifyPslCompletionContext(cursor)).toMatchObject({
        kind: 'fieldAttributeArgumentSlot',
        path: [],
        positionalIndex: 0,
        existingNamedKeys: ['fields', 'references'],
      });
      const signature = classifyPslSignatureContext(cursor);
      expect(signature).toMatchObject({
        attributeName: 'relation',
        path: [{ kind: 'namedArgument', name: 'references' }],
        argumentSlot: undefined,
      });
      expect(Object.keys(signature ?? {}).sort()).toEqual([
        'argumentSlot',
        'attributeName',
        'field',
        'model',
        'path',
      ]);
    },
  );

  it('completes a named key while selecting its signature value path', () => {
    const cursor = input('references|: [id]');
    expect(classifyPslCompletionContext(cursor)).toMatchObject({
      kind: 'fieldAttributeNamedKey',
      path: [],
      hasColon: true,
    });
    expect(classifyPslSignatureContext(cursor)).toMatchObject({
      path: [{ kind: 'namedArgument', name: 'references' }],
      argumentSlot: undefined,
    });
  });

  it('keeps the inner value path for identifier documentation', () => {
    const cursor = input('references: [{ item: nested(mode: S|trict) }]');
    const path = [
      { kind: 'namedArgument', name: 'references' },
      { kind: 'listElement' },
      { kind: 'recordValue' },
      { kind: 'functionCall', name: 'nested' },
      { kind: 'namedArgument', name: 'mode' },
    ];
    expect(classifyPslCompletionContext(cursor)).toMatchObject({
      kind: 'fieldAttributeValue',
      path,
    });
    expect(classifyPslSignatureContext(cursor)).toMatchObject({ path, argumentSlot: undefined });
  });
});
