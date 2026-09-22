import type {
  ArgType,
  AttributeSpec,
  AttributeSpecContext,
  AttributeSpecNamespace,
  FieldAttributeCtx,
  FieldAttributeSpecContext,
  FieldSymbol,
  FuncCallSig,
  InferAttr,
  ModelAttributeCtx,
  ModelSymbol,
  SymbolTable,
  TypedFuncCall,
} from '@internal/psl-parser';
import {
  bool,
  entityRef,
  fieldAttribute,
  fieldRef,
  funcCall,
  identifier,
  int,
  interpretAttribute,
  json,
  list,
  modelAttribute,
  num,
  oneOf,
  optional,
  type PslDiagnosticCollector,
  record,
  referencedFieldRef,
  str,
} from '@internal/psl-parser';
import type { FieldAttributeAst, ModelAttributeAst, PslSources } from '@internal/psl-parser/syntax';

export function findModelAttributeNode(
  model: ModelSymbol,
  name: string,
): ModelAttributeAst | undefined {
  for (const attribute of model.node.attributes()) {
    if (attribute.name()?.isSimpleName(name) === true) return attribute;
  }
  return undefined;
}

export function findFieldAttributeNode(
  field: FieldSymbol,
  name: string,
): FieldAttributeAst | undefined {
  for (const attribute of field.node.attributes()) {
    if (attribute.name()?.isSimpleName(name) === true) return attribute;
  }
  return undefined;
}

function buildModelAttributeCtx(input: {
  readonly symbols: SymbolTable;
  readonly selfModel: ModelSymbol;
  readonly sources: PslSources;
}): ModelAttributeCtx {
  return {
    sources: input.sources,
    selfModel: input.selfModel,
    symbols: input.symbols,
  };
}

function buildFieldAttributeCtx(input: {
  readonly symbols: SymbolTable;
  readonly selfModel: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sources: PslSources;
  readonly resolveReferencedModel?: (() => ModelSymbol | undefined) | undefined;
}): FieldAttributeCtx {
  return {
    sources: input.sources,
    selfModel: input.selfModel,
    resolveReferencedModel: input.resolveReferencedModel ?? (() => undefined),
    field: input.field,
    symbols: input.symbols,
  };
}

// Interpret a model-level attribute node against its spec, draining any parse
// failures into `diagnostics`. Returns the typed value, or `undefined` on
// failure so the caller can apply its own default/absence handling.
export function interpretModelAttribute<Out>(input: {
  readonly symbols: SymbolTable;
  readonly node: ModelAttributeAst;
  readonly spec: AttributeSpec<Out, ModelAttributeCtx>;
  readonly model: ModelSymbol;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildModelAttributeCtx({
      symbols: input.symbols,
      selfModel: input.model,
      sources: input.sources,
    }),
  );
  if (!result.ok) {
    input.diagnostics.push(...result.failure);
    return undefined;
  }
  return result.value;
}

// Interpret a field-level attribute node against its spec, draining any parse
// failures into `diagnostics`. Returns the typed value, or `undefined` on
// failure so the caller can apply its own default/absence handling.
export function interpretFieldAttribute<Out>(input: {
  readonly symbols: SymbolTable;
  readonly node: FieldAttributeAst;
  readonly spec: AttributeSpec<Out, FieldAttributeCtx>;
  readonly model: ModelSymbol;
  readonly field: FieldSymbol;
  readonly sources: PslSources;
  readonly diagnostics: PslDiagnosticCollector;
  readonly resolveReferencedModel?: () => ModelSymbol | undefined;
}): Out | undefined {
  const result = interpretAttribute(
    input.node,
    input.spec,
    buildFieldAttributeCtx({
      symbols: input.symbols,
      selfModel: input.model,
      field: input.field,
      sources: input.sources,
      resolveReferencedModel: input.resolveReferencedModel,
    }),
  );
  if (!result.ok) {
    input.diagnostics.push(...result.failure);
    return undefined;
  }
  return result.value;
}

export const mapModelSpec = modelAttribute('map', {
  documentation: 'Maps this model to a MongoDB collection name.',
  positional: [
    { key: 'name', type: str(), documentation: 'The collection name stored in MongoDB.' },
  ],
});
export const mapFieldSpec = fieldAttribute('map', {
  documentation: 'Maps this field to a stored document key.',
  positional: [{ key: 'name', type: str(), documentation: 'The key stored in MongoDB documents.' }],
});
export const idFieldSpec = fieldAttribute('id', {
  documentation: 'Identifies the document’s primary-key field.',
});
export const uniqueFieldSpec = fieldAttribute('unique', {
  documentation: 'Requires values in this field to be unique across the collection.',
});

export const relationFieldSpec = fieldAttribute('relation', {
  documentation:
    'Names a relation and associates local fields with fields on the referenced model.',
  positional: [
    {
      key: 'name',
      type: optional(str()),
      documentation: 'The relation name used to pair both sides. May also be supplied by name.',
    },
  ],
  named: {
    name: {
      type: optional(str()),
      documentation:
        'The relation name used to pair both sides. Cannot also be supplied positionally.',
    },
    fields: {
      type: optional(list(fieldRef(), { allowEmpty: false, unique: true })),
      documentation: 'The ordered local fields holding references to related documents.',
    },
    references: {
      type: optional(list(referencedFieldRef(), { allowEmpty: false, unique: true })),
      documentation: 'The corresponding fields on the referenced model.',
    },
  },
});
export type RelationFieldOutput = InferAttr<typeof relationFieldSpec>;

export const discriminatorModelSpec = modelAttribute('discriminator', {
  documentation: 'Selects the field that distinguishes inheritance variants in this collection.',
  positional: [
    { key: 'field', type: fieldRef(), documentation: 'The discriminator field on this model.' },
  ],
});
export function baseModelSpec() {
  return modelAttribute('base', {
    documentation: 'Declares this model as a variant of a base model.',
    positional: [
      {
        key: 'base',
        type: entityRef({ kind: 'model' }),
        documentation: 'The base model to inherit from.',
      },
      {
        key: 'value',
        type: str(),
        documentation: 'The discriminator value identifying this variant.',
      },
    ],
  });
}

const sortSig = {
  documentation: 'Selects an index field with an explicit sort direction.',
  named: {
    sort: {
      type: oneOf(
        identifier('Asc', { documentation: 'Sort ascending.' }),
        identifier('Desc', { documentation: 'Sort descending.' }),
      ),
      documentation: 'The index order for this field: `Asc` or `Desc`.',
    },
  },
} satisfies FuncCallSig;

function indexFieldElement(
  fieldNames: readonly string[],
): ArgType<string | TypedFuncCall, ModelAttributeCtx> {
  const arms: readonly [
    ArgType<string | TypedFuncCall, ModelAttributeCtx>,
    ...ArgType<string | TypedFuncCall, ModelAttributeCtx>[],
  ] = [
    fieldRef(),
    funcCall('wildcard', {
      documentation: 'Indexes document fields using a MongoDB wildcard index.',
      positional: [
        {
          key: 'scope',
          type: optional(identifier()),
          documentation: 'The field path to index recursively. Omit to index all document fields.',
        },
      ],
    }),
    ...fieldNames.map((name) => funcCall(name, sortSig)),
  ];
  return oneOf(...arms);
}

const collationNamedArgs = {
  collationLocale: {
    type: optional(str()),
    documentation: 'The ICU locale used for string comparison, or `simple` for binary comparison.',
  },
  collationStrength: {
    type: optional(oneOf(num(1), num(2), num(3), num(4), num(5))),
    documentation:
      'The collation comparison level, from `1` (primary differences) through `5` (identical).',
  },
  collationCaseLevel: {
    type: optional(bool()),
    documentation: 'Whether case differences are compared at strength `1` or `2`.',
  },
  collationCaseFirst: {
    type: optional(oneOf(str('upper'), str('lower'), str('off'))),
    documentation: 'Whether uppercase or lowercase sorts first, or `off` for the locale default.',
  },
  collationNumericOrdering: {
    type: optional(bool()),
    documentation: 'Whether numeric strings are compared as numbers rather than lexicographically.',
  },
  collationAlternate: {
    type: optional(oneOf(str('non-ignorable'), str('shifted'))),
    documentation:
      'Whether punctuation and whitespace are significant or shifted to a later comparison level.',
  },
  collationMaxVariable: {
    type: optional(oneOf(str('punct'), str('space'))),
    documentation:
      'Which characters are ignored when alternate handling is `shifted`: punctuation or spaces.',
  },
  collationBackwards: {
    type: optional(bool()),
    documentation: 'Whether secondary differences, such as accents, are compared in reverse order.',
  },
  collationNormalization: {
    type: optional(bool()),
    documentation: 'Whether strings are checked and normalized before comparison.',
  },
};

function buildIndexModelSpec(
  name: 'index' | 'unique',
  fieldElement: ArgType<string | TypedFuncCall, ModelAttributeCtx>,
) {
  return modelAttribute(name, {
    documentation:
      name === 'unique'
        ? 'Declares a unique MongoDB index over the selected fields.'
        : 'Declares a MongoDB index over the selected fields.',
    positional: [
      {
        key: 'fields',
        type: list(fieldElement, { allowEmpty: false }),
        documentation:
          name === 'unique'
            ? 'The nonempty list of indexed fields, optionally with sort directions. Wildcard scopes are not supported.'
            : 'The nonempty list of indexed fields, optionally with sort directions or a wildcard scope.',
      },
    ],
    named: {
      type: {
        type: optional(
          oneOf(num(1), num(-1), str('text'), str('2dsphere'), str('2d'), str('hashed')),
        ),
        documentation:
          'The MongoDB index key type: ascending `1`, descending `-1`, text, geospatial, or hashed.',
      },
      sparse: {
        type: optional(bool()),
        documentation: 'Whether documents missing indexed fields are omitted from the index.',
      },
      expireAfterSeconds: {
        type: optional(int()),
        documentation: 'The expiration interval in seconds for a TTL index.',
      },
      filter: {
        type: optional(json()),
        documentation: 'A JSON partial-filter expression limiting which documents are indexed.',
      },
      include: {
        type: optional(list(str())),
        documentation: 'Document paths included in the wildcard index projection.',
      },
      exclude: {
        type: optional(list(str())),
        documentation: 'Document paths excluded from the wildcard index projection.',
      },
      default_language: {
        type: optional(str()),
        documentation: 'The default language for text-index tokenization and stemming.',
      },
      languageOverride: {
        type: optional(str()),
        documentation: 'The document field that overrides the text-index language.',
      },
      ...collationNamedArgs,
    },
  });
}

function buildTextIndexModelSpec(fieldElement: ArgType<string | TypedFuncCall, ModelAttributeCtx>) {
  return modelAttribute('textIndex', {
    documentation:
      'Declares a MongoDB text index with optional field weights and language settings.',
    positional: [
      {
        key: 'fields',
        type: list(fieldElement, { allowEmpty: false }),
        documentation: 'The nonempty list of fields whose text is indexed.',
      },
    ],
    named: {
      filter: {
        type: optional(json()),
        documentation: 'A JSON partial-filter expression limiting which documents are indexed.',
      },
      weights: {
        type: optional(record(int({ min: 1, max: 99_999 }))),
        documentation: 'Relative text-search weights by field, each from `1` through `99999`.',
      },
      language: {
        type: optional(str()),
        documentation: 'The default language for tokenization and stemming.',
      },
      languageOverride: {
        type: optional(str()),
        documentation: 'The document field that overrides the text-index language.',
      },
      ...collationNamedArgs,
    },
  });
}

function modelFieldElement(
  ctx: AttributeSpecContext,
): ArgType<string | TypedFuncCall, ModelAttributeCtx> {
  return indexFieldElement(Object.keys(ctx.model.fields));
}

function staticModelSpec<Spec>(spec: Spec): (ctx: AttributeSpecContext) => Spec {
  return () => spec;
}

function staticFieldSpec<Spec>(spec: Spec): (ctx: FieldAttributeSpecContext) => Spec {
  return () => spec;
}

export const mongoAttributeSpecs = {
  model: {
    map: staticModelSpec(mapModelSpec),
    discriminator: staticModelSpec(discriminatorModelSpec),
    base: baseModelSpec,
    index: (ctx) => buildIndexModelSpec('index', modelFieldElement(ctx)),
    unique: (ctx) => buildIndexModelSpec('unique', modelFieldElement(ctx)),
    textIndex: (ctx) => buildTextIndexModelSpec(modelFieldElement(ctx)),
  },
  field: {
    id: staticFieldSpec(idFieldSpec),
    unique: staticFieldSpec(uniqueFieldSpec),
    map: staticFieldSpec(mapFieldSpec),
    relation: staticFieldSpec(relationFieldSpec),
  },
} as const satisfies AttributeSpecNamespace;
