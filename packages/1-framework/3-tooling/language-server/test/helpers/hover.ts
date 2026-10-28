import type {
  AuthoringPslBlockDescriptorNamespace,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup, dataType } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import {
  type ArgType,
  type AttributeCtx,
  blockAttribute,
  bool,
  buildSymbolTable,
  entityRef,
  fieldAttribute,
  fieldRef,
  funcCall,
  identifier,
  list,
  modelAttribute,
  numLiteral,
  oneOf,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { ok } from '@internal/utils/result';
import { expect } from 'vitest';
import { providePslHover } from '../../src/hover';
import { testBinder } from './binder';

const relatesTo = fieldAttribute('relatesTo', {
  documentation: '',
  named: { fields: { type: fieldRef(), documentation: '' } },
});
const guardedBy = modelAttribute('guardedBy', {
  documentation: '',
  named: { policy: { type: entityRef({ kind: 'block', keyword: 'policy' }), documentation: '' } },
});
const relationSpec = fieldAttribute('relation', {
  documentation: 'Declares a relation.',
  named: {
    name: { type: optional(str()), documentation: 'An explicit relation name.' },
  },
});
const incompleteKeySpec = fieldAttribute('incompleteKey', {
  documentation: '',
  named: {
    references: { type: optional(str()), documentation: 'Referenced fields.' },
  },
});
const onDeleteSpec = fieldAttribute('onDeleteExample', {
  documentation: '',
  named: {
    onDelete: {
      type: oneOf(
        identifier('NoAction', { documentation: 'Takes no action.' }),
        identifier('Restrict', { documentation: 'Rejects the delete.' }),
        identifier('Cascade', { documentation: 'Cascades the delete.' }),
      ),
      documentation: '',
    },
  },
});
const indexSpec = modelAttribute('index', {
  documentation: 'Declares an index.',
  named: { fields: { type: list(str()), documentation: 'Indexed field names.' } },
});
const autoincrementFunc = funcCall('autoincrement', {
  documentation: 'Generates sequential integers.',
});
const dbgeneratedFunc = funcCall('dbgenerated', {
  documentation: 'Lets the database generate the value.',
  named: { expr: { type: str(), documentation: 'The database expression.' } },
});
const defaultSpec = fieldAttribute('default', {
  documentation: '',
  positional: [
    { key: 'value', type: oneOf(autoincrementFunc, dbgeneratedFunc), documentation: '' },
  ],
});
function nullLiteral(): ArgType<null, AttributeCtx> {
  const nullIdentifier = identifier('null', { documentation: 'A null value.' });
  return {
    kind: 'null',
    label: 'null',
    parse: (arg, ctx) => {
      const result = nullIdentifier.parse(arg, ctx);
      return result.ok ? ok(null) : result;
    },
  };
}
const autoincrementRealOrderFunc = funcCall('autoincrement', {
  documentation: 'Generates sequential integers.',
});
const defaultRealOrderSpec = fieldAttribute('default', {
  documentation: '',
  positional: [
    {
      key: 'value',
      type: oneOf(str(), numLiteral(), bool(), nullLiteral(), autoincrementRealOrderFunc),
      documentation: '',
    },
  ],
});
const someBlockAttribute = blockAttribute('someBlockAttribute', {
  documentation: 'Does something.',
  positional: [{ key: 'value', type: str(), documentation: 'The value.' }],
});
const authoringContributions = assembleAuthoringContributions([
  {
    id: 'hover-fixture',
    authoring: {
      attributeSpecs: {
        field: {
          relatesTo: () => relatesTo,
          relation: () => relationSpec,
          incompleteKey: () => incompleteKeySpec,
          onDeleteExample: () => onDeleteSpec,
          default: () => defaultSpec,
          defaultRealOrder: () => defaultRealOrderSpec,
        },
        model: { guardedBy: () => guardedBy, index: () => indexSpec },
      },
      type: {
        pg: {
          Varchar: {
            kind: 'typeConstructor',
            documentation: 'A variable-length string.',
            args: [{ name: 'length', kind: 'value', dataType: 'fixture/int' }],
            output: { codecId: 'fixture/varchar' },
          },
          Text: {
            kind: 'typeConstructor',
            output: { codecId: 'fixture/text' },
          },
          Raw: {
            kind: 'typeConstructor',
            documentation: 'A type written as SQL.',
            args: [{ name: 'sql', kind: 'value', dataType: 'fixture/expression' }],
            output: { codecId: 'fixture/raw' },
          },
          Flag: {
            kind: 'typeConstructor',
            documentation: '',
            output: { codecId: 'fixture/flag' },
          },
          Moment: {
            kind: 'typeChoice',
            documentation: 'A moment in time.',
            args: [
              {
                kind: 'option',
                name: 'as',
                values: ['date', 'text'],
                default: 'date',
                optional: true,
              },
              {
                kind: 'option',
                name: 'storage',
                values: ['wide', 'narrow'],
                default: 'wide',
                optional: true,
              },
              { kind: 'value', name: 'precision', dataType: 'fixture/int', optional: true },
            ],
            choices: [
              {
                when: { as: 'date', storage: 'wide' },
                type: 'Stamp',
                defaults: { precision: 3 },
              },
              { when: { as: 'text', storage: 'wide' }, type: 'Text' },
              { when: { as: 'date', storage: 'narrow' }, type: 'Flag' },
            ],
          },
          Shape: {
            kind: 'typeChoice',
            documentation: '',
            args: [
              {
                kind: 'option',
                name: 'as',
                values: ['raw', 'huge'],
                default: 'raw',
                optional: true,
              },
              { kind: 'value', name: 'sql', dataType: 'fixture/expression', optional: true },
              { kind: 'value', name: 'precision', dataType: 'fixture/int', optional: true },
            ],
            choices: [
              { when: { as: 'raw' }, type: 'Raw', defaults: { sql: 'text' } },
              { when: { as: 'huge' }, type: 'Stamp', defaults: { precision: { digits: 10 } } },
            ],
          },
          Stamp: {
            kind: 'typeConstructor',
            args: [{ name: 'precision', kind: 'value', dataType: 'fixture/int', optional: true }],
            output: { codecId: 'fixture/stamp' },
          },
          CreatedAt: {
            kind: 'typeAlias',
            documentation: 'Set to now when a row is created.',
            output: { type: { codecId: 'fixture/text' }, onCreate: { name: 'now', args: {} } },
          },
        },
      },
    },
  },
]);
const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
  policy: {
    kind: 'pslBlock',
    documentation: 'Row-level access rule.',
    keyword: 'policy',
    discriminator: 'hover-policy',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: {
          using: { type: str(), documentation: 'The policy filter expression.' },
        },
      }),
    attributes: { someBlockAttribute: () => someBlockAttribute },
  },
  view: {
    kind: 'pslBlock',
    keyword: 'view',
    discriminator: 'hover-view',
    name: { required: true },
    spec: () => structBlock({ parameters: {} }),
  },
};

const fixtureInt = dataType('fixture/int', { read: (json) => json });
const fixtureExpression = dataType('fixture/expression', { read: (json) => json });
const dataTypes: DataTypeSupport = {
  entries: {
    [fixtureInt.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [fixtureInt.id],
        classify: (text) => ({ type: fixtureInt.id, value: Number(text) }),
      },
      print: String,
      documentation: 'A whole number.',
    },
    [fixtureExpression.id]: {
      written: { kind: 'tag', tag: 'sql', parse: (text) => text },
      print: String,
      documentation: 'A SQL expression.',
    },
  },
  lookup: createDataTypeLookup([fixtureInt, fixtureExpression]),
  dataTypeOfCodec: () => undefined,
};

export function hover(markedSource: string, siblings: readonly string[] = []) {
  const offset = markedSource.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + 1);
  const parsed = parse(source, 'language-server-test.psl');
  const { document } = parsed;
  const others = siblings.map((text, index) => parse(text, `sibling-${index}.psl`));
  const sources = parsed.sources.merge(...others.map((other) => other.sources));
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable } = buildSymbolTable({
    documents: [...others.map((other) => other.document), document],
    sources,
    defaultNamespaceId: 'public',
  });
  return providePslHover({
    document,
    sourceFile,
    position: sourceFile.positionAt(offset),
    binder: testBinder({ sources, symbolTable, authoringContributions, pslBlockDescriptors }),
    pslBlockDescriptors,
    dataTypes,
    sources,
  });
}
