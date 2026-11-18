import type {
  AuthoringTypeAliasDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_TYPES, typeAttributeSubjectLabel } from '../src/attribute-spec/spec-context';
import { type BinderContext, createBinder } from '../src/binder';
import { contributedTypeCodecId } from '../src/contributed-type-scope';
import { createPslDiagnosticCollector } from '../src/diagnostic';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import {
  refuseRepeatedTypeAliasAttributes,
  resolveTypeAliases,
  typeAliasOfField,
  typeAliasSpecContext,
} from '../src/type-aliases';

const text: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/text@1' },
};

const varchar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: 'fixture/int', name: 'length' }],
  output: { codecId: 'fixture/varchar@1' },
};

const timestamp: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/timestamp@1' },
};

const updatedAt: AuthoringTypeAliasDescriptor = {
  kind: 'typeAlias',
  output: {
    type: { codecId: 'fixture/timestamp@1' },
    onCreate: { name: 'now', args: {} },
    onUpdate: { name: 'now', args: {} },
  },
};

const dated: AuthoringTypeAliasDescriptor = {
  kind: 'typeAlias',
  output: { type: { codecId: 'fixture/date@1' }, onCreate: { name: 'now', args: {} } },
};

function context(): BinderContext {
  return {
    authoringContributions: {
      type: {
        String: text,
        VarChar: varchar,
        Timestamp: timestamp,
        temporal: { UpdatedAt: updatedAt, Dated: dated },
      },
      entityTypes: {},
      attributeSpecs: { model: {}, field: {} },
      modelAttributes: {},
      pslBlockDescriptors: {},
      dataTypes: {},
    },
    controlMutationDefaults: { defaultFunctionRegistry: new Map() },
    generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
    dataTypes: EMPTY_DATA_TYPES,
  };
}

type ResolveOptions = Pick<
  Parameters<typeof resolveTypeAliases>[0],
  'describeUnsupportedAttribute' | 'acceptedAttributes'
>;

function resolve(schema: string, options: ResolveOptions = {}) {
  const { document, sources } = parse(schema, 'schema.prisma');
  const pslSources = new PslSources([[document.syntax, sources.sourceFileFor(document.syntax)]]);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources: pslSources,
    defaultNamespaceId: 'public',
  });
  const { binder } = createBinder({ symbolTable, sources: pslSources, context: context() });
  const diagnostics = createPslDiagnosticCollector(pslSources);
  const aliases = resolveTypeAliases({
    declarations: Object.values(symbolTable.namedTypes),
    binder,
    sources: pslSources,
    diagnostics,
    authoringTypes: context().authoringContributions.type,
    ...options,
  });
  const reported = () =>
    diagnostics.toExternal().map(({ code, message, span }) => ({
      code,
      message,
      line: span?.start.line,
    }));
  return { aliases, symbolTable, binder, sources: pslSources, diagnostics, reported };
}

describe('resolveTypeAliases', () => {
  it('reads a called constructor, a bare constructor and a block as a base, keeping the attributes a field takes', () => {
    const { aliases, symbolTable, reported } = resolve(`enum Role {
  User
}

types {
  Slug  = VarChar(64) @default("a") @onCreate(f()) @onUpdate(f())
  Name  = String
  Roles = Role
}`);
    const { Slug, Name, Roles } = symbolTable.namedTypes;
    expect(reported()).toEqual([]);
    expect({
      slug: Slug === undefined ? undefined : aliases.get(Slug),
      name: Name === undefined ? undefined : aliases.get(Name),
      roles: Roles === undefined ? undefined : aliases.get(Roles),
    }).toMatchObject({
      slug: {
        base: { kind: 'typeConstructor', descriptor: varchar, call: { path: ['VarChar'] } },
        baseName: 'VarChar',
        attributes: [{ name: 'default' }, { name: 'onCreate' }, { name: 'onUpdate' }],
      },
      name: { base: { kind: 'typeConstructor', descriptor: text, call: undefined } },
      roles: { base: { kind: 'block', symbol: { name: 'Role' } }, baseName: 'Role' },
    });
  });

  it('refuses a base that is another alias, a constructor that needs arguments, or missing', () => {
    const { aliases, reported } = resolve(`types {
  A = String @default("a")
  B = A
  D = VarChar
  E = Missing()
}`);
    expect({ resolved: aliases.size, reported: reported() }).toEqual({
      resolved: 1,
      reported: [
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = String @default("a")',
          line: 3,
        },
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message: 'Type alias "D" references unsupported base type "VarChar"',
          line: 4,
        },
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR',
          message: 'Type alias "E" references unsupported constructor "Missing"',
          line: 5,
        },
      ],
    });
  });

  describe('the refusal of an alias written as another alias', () => {
    it('follows a chain to the first base that is not an alias', () => {
      const { reported } = resolve(`types {
  A = String @default("a")
  B = A @onUpdate(f())
  C = B
}`);
      expect(reported()).toEqual([
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = String @default("a") @onUpdate(f())',
          line: 3,
        },
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "C" is written as the type alias "B", and a type alias cannot be written as another one. Write what "B" stands for instead: C = String @default("a") @onUpdate(f())',
          line: 4,
        },
      ]);
    });

    it('suggests nothing for a cycle', () => {
      const { reported } = resolve(`types {
  X = Y
  Y = X
}`);
      expect(reported()).toEqual([
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "X" is written as the type alias "Y", and a type alias cannot be written as another one.',
          line: 2,
        },
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "Y" is written as the type alias "X", and a type alias cannot be written as another one.',
          line: 3,
        },
      ]);
    });

    it('leaves out comments', () => {
      const { reported } = resolve(`types {
  A = VarChar(8) // the short one
    @default("a  b")
  B = A
}`);
      expect(reported()).toEqual([
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "B" is written as the type alias "A", and a type alias cannot be written as another one. Write what "A" is written as instead: B = VarChar(8) @default("a  b")',
          line: 4,
        },
      ]);
    });

    it('writes the whole line for a contributed alias when a type constructor gives its type', () => {
      const { reported } = resolve(`types {
  X = temporal.UpdatedAt
  Y = temporal.Dated
}`);
      expect(reported()).toEqual([
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "X" is written as the type alias "temporal.UpdatedAt", and a type alias cannot be written as another one. Type the fields temporal.UpdatedAt instead, or write: X = Timestamp @onCreate(now()) @onUpdate(now())',
          line: 2,
        },
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_BASE',
          message:
            'Type alias "Y" is written as the type alias "temporal.Dated", and a type alias cannot be written as another one. Type the fields temporal.Dated instead, or write Y as a type constructor with @onCreate(now()).',
          line: 3,
        },
      ]);
    });
  });

  it('refuses and drops any other attribute, keeping the alias, in the family wording when it gives one', () => {
    const { aliases, reported } = resolve(
      `types {
  Slug = String @map("x") @db.Text
}`,
      {
        describeUnsupportedAttribute: (attribute, declaration) =>
          attribute.name === 'db.Text' ? `${declaration.name} takes no @db.Text` : undefined,
      },
    );
    expect({
      attributes: [...aliases.values()].map((alias) => alias.attributes),
      reported: reported(),
    }).toEqual({
      attributes: [[]],
      reported: [
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: 'Type alias "Slug" uses unsupported attribute "map"',
          line: 2,
        },
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: 'Slug takes no @db.Text',
          line: 2,
        },
      ],
    });
  });

  it('refuses @id and @unique, which belong on a field, in every family', () => {
    const { reported } = resolve(
      `types {
  Key = String @id @unique
}`,
      { describeUnsupportedAttribute: () => 'family wording' },
    );
    expect(reported()).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Key" cannot carry @id. @id and @unique belong to a model\'s field, not to its type; write them on the field.',
        line: 2,
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          'Type alias "Key" cannot carry @unique. @id and @unique belong to a model\'s field, not to its type; write them on the field.',
        line: 2,
      },
    ]);
  });

  it('keeps only the attributes the family accepts', () => {
    const { aliases, reported } = resolve(
      `types {
  Stamp = String @default("x") @onCreate(now())
}`,
      { acceptedAttributes: new Set(['onCreate', 'onUpdate']) },
    );
    expect({
      attributes: [...aliases.values()].map((alias) => alias.attributes.map(({ name }) => name)),
      reported: reported(),
    }).toEqual({
      attributes: [['onCreate']],
      reported: [
        {
          code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
          message: 'Type alias "Stamp" uses unsupported attribute "default"',
          line: 2,
        },
      ],
    });
  });
});

describe('a field typed by a type alias', () => {
  const schema = `types {
  Slug = VarChar(64) @default("a")
}

model Post {
  slug  Slug @default("b") @unique
  title String
}`;

  it('finds its alias, and reads the alias attributes in a context named for the alias', () => {
    const { aliases, symbolTable, binder } = resolve(schema);
    const fields = symbolTable.defaultNamespace.models['Post']?.fields;
    const slug = fields?.['slug'];
    const title = fields?.['title'];
    const alias = slug === undefined ? undefined : typeAliasOfField(slug, binder, aliases);
    const context =
      alias === undefined
        ? undefined
        : typeAliasSpecContext(alias, {
            symbols: symbolTable,
            binder,
            defaultFunctionRegistry: new Map(),
            generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
            dataTypes: EMPTY_DATA_TYPES,
          });
    expect({
      alias: alias?.symbol.name,
      untyped: title === undefined ? undefined : typeAliasOfField(title, binder, aliases),
      subject: context === undefined ? undefined : typeAttributeSubjectLabel(context.subject),
      list: context?.list,
      typeName: context?.typeName,
      codecId:
        context?.contributedType === undefined
          ? undefined
          : contributedTypeCodecId(context.contributedType, EMPTY_DATA_TYPES),
    }).toEqual({
      alias: 'Slug',
      untyped: undefined,
      subject: 'Type alias "Slug"',
      list: false,
      typeName: 'VarChar',
      codecId: 'fixture/varchar@1',
    });
  });

  it('is refused for each attribute it repeats from its alias, and may add others', () => {
    const { aliases, symbolTable, binder, sources, diagnostics, reported } = resolve(schema);
    const slug = symbolTable.defaultNamespace.models['Post']?.fields['slug'];
    const alias = slug === undefined ? undefined : typeAliasOfField(slug, binder, aliases);
    const refused =
      slug !== undefined &&
      alias !== undefined &&
      refuseRepeatedTypeAliasAttributes({
        field: slug,
        fieldPath: 'Post.slug',
        alias,
        sources,
        diagnostics,
      });
    expect({ refused, reported: reported() }).toEqual({
      refused: true,
      reported: [
        {
          code: 'PSL_DUPLICATE_ATTRIBUTE',
          message:
            'Field "Post.slug" writes @default, which its type alias "Slug" already sets. Remove one of them.',
          line: 6,
        },
      ],
    });
  });
});
