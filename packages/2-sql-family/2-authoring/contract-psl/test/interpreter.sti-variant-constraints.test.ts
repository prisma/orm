import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

const controlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    ...fixtureInterpreterTypes,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults,
  });
}

function tablesOf(schema: string) {
  const result = interpret(schema);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  const storage = result.value.storage as SqlStorage;
  return storage.namespaces['public']?.entries.table ?? {};
}

function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  if (result.ok) throw new Error('expected the schema to be refused');
  return result.failure.diagnostics;
}

const contactOf = (backRelations: string) => `model Contact {
  id     Int          @id
  humans HumanActor[] @relation("Human")
${backRelations}
  @@map("contact")
}`;

const contact = contactOf('');

const team = `model Team {
  id   Int        @id
  bots BotActor[] @relation("Bot")

  @@map("team")
}`;

const actor = `model Actor {
  id   Int    @id
  kind String

  @@discriminator(kind)
  @@map("actor")
}`;

const humanWithContact = (body: string) => `model HumanActor {
  contact   Contact  @relation("Human", fields: [contactId], references: [id], onDelete: Cascade)
  contactId Int
  email     String?
${body}
  @@base(Actor, "human")
}`;

const botWithOwner = (target: 'Contact' | 'Team') => `model BotActor {
  owner     ${target} @relation("Bot", fields: [contactId], references: [id], onDelete: Cascade)
  contactId Int

  @@base(Actor, "bot")
}`;

describe('constraints declared on a single-table variant', () => {
  it("puts the variant's foreign key on the base table, keeping its referential action", () => {
    const tables = tablesOf([contact, actor, humanWithContact('')].join('\n\n'));

    expect(tables['actor']?.columns['contactId']).toMatchObject({ nullable: true });
    expect(tables['actor']?.foreignKeys).toMatchObject([
      {
        source: { columns: ['contactId'] },
        target: { tableName: 'contact', columns: ['id'] },
        onDelete: 'cascade',
      },
    ]);
  });

  it('keeps one foreign key when two variants declare the same one on a shared column', () => {
    const tables = tablesOf(
      [
        contactOf('  bots BotActor[] @relation("Bot")'),
        actor,
        humanWithContact(''),
        botWithOwner('Contact'),
      ].join('\n\n'),
    );

    expect(tables['actor']?.foreignKeys).toMatchObject([
      { source: { columns: ['contactId'] }, target: { tableName: 'contact' } },
    ]);
  });

  it('refuses two variants that declare foreign keys on a shared column to different targets', () => {
    const schema = [contact, team, actor, humanWithContact(''), botWithOwner('Team')].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Models "BotActor" and "HumanActor" share the table of their base model "Actor" (single-table inheritance) and declare different foreign keys on (contactId). Every row would have to satisfy both; give each variant its own column.',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('@relation("Bot", fields') }),
        }),
      }),
    ]);
  });

  it('accepts an index the variant scopes with a condition, as a partial index on the base table', () => {
    const tables = tablesOf(
      [
        contact,
        actor,
        humanWithContact(`  @@index([email], where: sql\`kind = 'human'\`)
  @@index([contactId], unique: true, where: sql\`kind = 'human'\`)`),
      ].join('\n\n'),
    );

    expect(tables['actor']?.indexes).toMatchObject([
      { columns: ['email'], where: "kind = 'human'" },
      { columns: ['contactId'], unique: true, where: "kind = 'human'" },
      { columns: ['contactId'], unique: false },
    ]);
    expect(tables['actor']?.uniques).toEqual([]);
  });

  it('stores the same table as when the base model declares the column, relation and index', () => {
    const fromVariant = tablesOf(
      [
        contact,
        actor,
        humanWithContact(`  @@index([contactId], where: sql\`kind = 'human'\`)`),
      ].join('\n\n'),
    );
    const fromBase = tablesOf(`model Contact {
  id     Int     @id
  actors Actor[]

  @@map("contact")
}

model Actor {
  id        Int      @id
  kind      String
  contact   Contact? @relation(fields: [contactId], references: [id], onDelete: Cascade)
  contactId Int?
  email     String?

  @@index([contactId], where: sql\`kind = 'human'\`)
  @@discriminator(kind)
  @@map("actor")
}

model HumanActor {
  @@base(Actor, "human")
}`);

    expect(fromVariant['actor']).toEqual(fromBase['actor']);
  });

  it('refuses every unique and every index without a condition, each at its attribute', () => {
    const attributes = [
      '@@unique([email])',
      '@@index([contactId])',
      '@@index([email], unique: true)',
    ];
    const schema = [
      contact,
      actor,
      humanWithContact(attributes.map((attribute) => `  ${attribute}`).join('\n')).replace(
        'email     String?',
        'email     String? @unique',
      ),
    ].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual(
      ['@unique', ...attributes].map((attribute) =>
        expect.objectContaining({
          code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: schema.indexOf(attribute) }),
          }),
        }),
      ),
    );
  });

  it.each([
    {
      attribute: '@@unique([email])',
      advice: "@@index([email], unique: true, where: sql`kind = 'human'`)",
    },
    {
      attribute: '@@index([email], map: "actor_email")',
      advice: '@@index([email], map: "actor_email", where: sql`kind = \'human\'`)',
    },
  ])('advises a partial index scoped to the variant for $attribute', ({ attribute, advice }) => {
    expect(
      diagnosticsOf([contact, actor, humanWithContact(`  ${attribute}`)].join('\n\n')),
    ).toEqual([
      expect.objectContaining({
        message: `Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance), so "${attribute.split('(')[0]}" would also cover the rows of other variants. Scope it to this variant instead: ${advice}`,
      }),
    ]);
  });

  it('keeps a unique on a multi-table variant, which has its own table', () => {
    const tables = tablesOf(`${actor}

model RobotActor {
  serial String

  @@unique([serial])
  @@base(Actor, "robot")
  @@map("robot_actor")
}`);

    expect(tables['robot_actor']?.uniques).toMatchObject([{ columns: ['serial'] }]);
  });
});
