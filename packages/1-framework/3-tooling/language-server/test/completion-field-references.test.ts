import {
  assembleAuthoringContributions,
  assembleControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  buildSymbolTable,
  type FuncCallSig,
  fieldAttribute,
  fieldRef,
  funcCall,
  list,
  modelAttribute,
  referencedFieldRef,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { classifyPslCompletionContext } from '../src/completion-context';
import { providePslCompletionItems } from '../src/completion-provider';

const completionOnlyNestedSignature = {
  named: { local: list(fieldRef()), remote: list(referencedFieldRef()) },
} as unknown as FuncCallSig;
const fieldSpec = fieldAttribute('probe', {
  named: {
    local: list(fieldRef()),
    remote: list(referencedFieldRef()),
    nested: funcCall('fields', completionOnlyNestedSignature),
  },
});
const modelSpec = modelAttribute('probe', { named: { local: list(fieldRef()) } });
const authoringContributions = assembleAuthoringContributions([
  {
    id: 'scoped-completion-fixture',
    authoring: {
      attributeSpecs: { field: { probe: () => fieldSpec }, model: { probe: () => modelSpec } },
    },
  },
]);

function complete(markedSource: string) {
  const offset = markedSource.indexOf('|');
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const { document, sourceFile } = parse(source);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: {},
  });
  const items = providePslCompletionItems({
    context: classifyPslCompletionContext({
      document,
      sourceFile,
      position: sourceFile.positionAt(offset),
    }),
    sourceFile,
    candidates: {
      scalarTypes: ['String'],
      symbolTable,
      pslBlockDescriptors: {},
      authoringContributions,
      controlMutationDefaults: assembleControlMutationDefaults([]),
    },
    clientSupportsSnippets: false,
  });
  return { labels: items.map((item) => item.label), items, sourceFile };
}

function schema(type: string, args: string) {
  return `model Target { topOnly String }
namespace local {
  model Target { localOnly String }
  model Owner {
    ownOnly String
    relation ${type} @probe(${args})
  }
}
namespace remote { model Target { remoteOnly String } }
namespace unrelated { model Missing { unrelatedOnly String } }`;
}

describe('scoped field-reference completion', () => {
  it('uses declaring-model fields for local references', () => {
    expect(complete(schema('remote.Target', 'local: [|]')).labels).toEqual(['ownOnly', 'relation']);
  });

  it('uses explicitly referenced fields rather than declaring-model fields', () => {
    expect(complete(schema('remote.Target', 'remote: [|]')).labels).toEqual(['remoteOnly']);
  });

  it('prefers the declaring namespace for unqualified targets', () => {
    expect(complete(schema('Target', 'remote: [|]')).labels).toEqual(['localOnly']);
  });

  it('falls back to top-level models only for an unqualified target', () => {
    const source = `model Target { topOnly String }
namespace local { model Owner { relation Target @probe(remote: [|]) } }
namespace unrelated { model Target { unrelatedOnly String } }`;
    expect(complete(source).labels).toEqual(['topOnly']);
  });

  it('resolves an unqualified top-level relation without searching namespaces', () => {
    expect(
      complete(
        'model Target { topOnly String }\nmodel Owner { relation Target @probe(remote: [|]) }\nnamespace remote { model Target { remoteOnly String } }',
      ).labels,
    ).toEqual(['topOnly']);
  });

  it.each([
    'missing.Target',
    'remote.Missing',
    'Missing',
    'foreign:remote.Target',
    'foreign:Target',
    'remote.extra.Target',
  ])('offers no referenced fields for unresolved or unavailable target %s', (type) => {
    expect(complete(schema(type, 'remote: [|]')).items).toEqual([]);
  });

  it.each(['remote.Target?', 'remote.Target[]'])(
    'uses type coordinates independently of cardinality: %s',
    (type) => {
      expect(complete(schema(type, 'remote: [|]')).labels).toEqual(['remoteOnly']);
    },
  );

  it('retains the declaring model inside a function and list', () => {
    expect(complete(schema('remote.Target', 'nested: fields(local: [|])')).labels).toEqual([
      'ownOnly',
      'relation',
    ]);
  });

  it('retains the referenced model inside a function and list', () => {
    expect(complete(schema('remote.Target', 'nested: fields(remote: [|])')).labels).toEqual([
      'remoteOnly',
    ]);
  });

  it('preserves namespace ownership in a model attribute', () => {
    expect(
      complete(
        'model Owner { topOnly String }\nnamespace local { model Owner { ownOnly String\n @@probe(local: [|]) } }',
      ).labels,
    ).toEqual(['ownOnly']);
  });

  it('retains referenced fields in a recovered missing-element gap', () => {
    expect(complete(schema('remote.Target', 'remote: [, |]')).labels).toEqual(['remoteOnly']);
  });

  it('does not append a reference in trivia after a completed field name', () => {
    expect(complete(schema('remote.Target', 'remote: [remoteOnly |]')).items).toEqual([]);
  });

  it('replaces the complete partial field token', () => {
    const result = complete(schema('remote.Target', 'remote: [rem|oteOnly]'));
    expect(result.labels).toEqual(['remoteOnly']);
    const edit = result.items[0]?.textEdit;
    expect(edit).toBeDefined();
    if (edit === undefined || !('range' in edit)) throw new Error('missing edit');
    expect(
      result.sourceFile.text.slice(
        result.sourceFile.offsetAt(edit.range.start),
        result.sourceFile.offsetAt(edit.range.end),
      ),
    ).toBe('remoteOnly');
    expect(edit.newText).toBe('remoteOnly');
  });
});
