import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  type BlockSpecContext,
  fieldAttribute,
  jsonValue,
  structBlock,
} from '@internal/psl-parser';
import { describe, expect, it } from 'vitest';
import {
  complete,
  completeWithSource,
  completionItemByLabel,
  controlMutationDefaults,
} from './helpers/completion-provider';

describe('providePslCompletionItems', () => {
  it('completes a generic block value from the block spec', () => {
    const { items } = complete(['policy Rule {', '  on = |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['User', 'public', 'auth']);
  });

  it('returns descriptor-backed generic block parameter completions', () => {
    const { items, sourceFile, cursorOffset } = complete(['policy Rule {', '  |', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
    expect(items.map((item) => item.detail)).toEqual([
      'Generic block parameter',
      'The policy predicate.',
      'Generic block parameter',
      'Generic block parameter',
    ]);
    expect(items[0]?.textEdit).toEqual({
      range: {
        start: sourceFile.positionAt(cursorOffset),
        end: sourceFile.positionAt(cursorOffset),
      },
      newText: 'on = ',
    });
  });

  it('returns the full descriptor-backed generic block parameter set excluding already-present sibling keys', () => {
    const { items, sourceFile, cursorOffset } = complete(
      ['policy Rule {', '  on = User', '  wh|', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['where', 'mode', 'using']);
    expect(items.find((item) => item.label === 'where')).toMatchObject({
      filterText: 'where',
      textEdit: {
        range: {
          start: sourceFile.positionAt(cursorOffset - 'wh'.length),
          end: sourceFile.positionAt(cursorOffset),
        },
        newText: 'where = ',
      },
    });
  });

  it('uses generic block parameter documentation with a fallback for undocumented parameters', () => {
    const { items } = complete('policy Rule { | }');
    expect(completionItemByLabel(items, 'where').detail).toBe('The policy predicate.');
    expect(completionItemByLabel(items, 'on').detail).toBe('Generic block parameter');
  });

  it('still offers the in-progress key while excluding an already-present sibling key', () => {
    const { items } = complete(['policy Rule {', '  where = "x"', '  on|', '}'].join('\n'));

    expect(items.map((item) => item.label)).toEqual(['on', 'mode', 'using']);
  });

  it('returns no generic block parameter completions without a matching descriptor', () => {
    const { items } = complete(['extension Rule {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('offers no key candidates for an arbitrary-key block spec', () => {
    const { items } = complete(['inventory Stock {', '  |', '}'].join('\n'));

    expect(items).toEqual([]);
  });

  it('keeps key completion available inside an invalid block', () => {
    const { items } = complete(
      ['policy Rule {', '  bogus = "not a declared key"', '  |', '}'].join('\n'),
    );

    expect(items.map((item) => item.label)).toEqual(['on', 'where', 'mode', 'using']);
  });

  it('calls the spec factory with the spec context and never invokes rule parsing', () => {
    const dataTypes: DataTypeSupport = {
      entries: {},
      lookup: createDataTypeLookup([]),
      dataTypeOfCodec: () => undefined,
    };
    const factoryContexts: BlockSpecContext[] = [];
    const throwingRule = {
      kind: 'str' as const,
      label: 'string',
      value: undefined,
      parse: () => {
        throw new Error('metadata inspection must not invoke rule parsing');
      },
    };
    const { items } = completeWithSource({
      markedSource: ['guard Rule {', '  |', '}'].join('\n'),
      pslBlockDescriptors: {
        guard: {
          kind: 'pslBlock',
          keyword: 'guard',
          discriminator: 'fixture-guard',
          name: { required: true },
          spec: (ctx: BlockSpecContext) => {
            factoryContexts.push(ctx);
            return structBlock({
              parameters: {
                shield: { type: throwingRule, documentation: 'The shield key.' },
              },
            });
          },
        },
      },
      dataTypes,
    });

    expect(items.map((item) => item.label)).toEqual(['shield']);
    expect(items[0]?.detail).toBe('The shield key.');
    expect(factoryContexts).toHaveLength(2);
    for (const ctx of factoryContexts) {
      expect(ctx).toEqual({ symbols: expect.any(Object), dataTypes: expect.any(Object) });
      expect(ctx.dataTypes).toBe(dataTypes);
    }
  });

  it.each(['|', '[|]', '{ nested: | }', '[{ nested: [|] }]'])(
    'completes recursive JSON values at %s',
    (value) => {
      const { items } = completeWithSource({
        markedSource: `model Post { value String @jsonFixture(${value}) }`,
        pslBlockDescriptors: {},
        authoringContributions: assembleAuthoringContributions([
          {
            id: 'json-fixture',
            authoring: {
              attributeSpecs: {
                field: {
                  jsonFixture: () =>
                    fieldAttribute('jsonFixture', {
                      documentation: '',
                      positional: [{ key: 'value', type: jsonValue(), documentation: '' }],
                    }),
                },
                model: {},
              },
            },
          },
        ]),
        controlMutationDefaults,
      });
      expect(items.map((item) => item.label)).toEqual(['true', 'false', 'null']);
    },
  );
});
