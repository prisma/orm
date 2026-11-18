import { describe, expect, it } from 'vitest';
import {
  actor,
  botWithOwner,
  contact,
  contactOf,
  diagnosticsOf,
  humanWithContact,
  tablesOf,
  team,
} from './sti-variant-support';

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

  it("accepts an index without a condition on the columns of the variant's own foreign key, as a printed contract writes it", () => {
    const written = tablesOf(
      [
        contact,
        actor,
        humanWithContact('  @@index([contactId], name: "actor_contactId_idx")'),
      ].join('\n\n'),
    );
    const derived = tablesOf([contact, actor, humanWithContact('')].join('\n\n'));

    expect(written['actor']?.indexes).toMatchObject([{ columns: ['contactId'], unique: false }]);
    expect(written['actor']?.indexes).toHaveLength(derived['actor']?.indexes.length ?? 0);
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
      '@@unique([contactId, email])',
      '@@index([email])',
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
        message: `Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance), so "${attribute.split('(')[0]}" would also cover the rows of other variants. Without a condition, only the backing index of one of its own relations is accepted. Scope it to this variant instead: ${advice}`,
      }),
    ]);
  });

  it.each([
    { form: '@unique', field: 'contactId Int? @unique', attribute: '' },
    { form: '@@unique', field: 'contactId Int?', attribute: '  @@unique([contactId])' },
  ])(
    'refuses $form behind a one-to-one relation from the variant with one diagnostic that says it is not supported',
    ({ form, field, attribute }) => {
      const schema = `model Contact {
  id    Int         @id
  human HumanActor? @relation("Human")

  @@map("contact")
}

${actor}

model HumanActor {
  contact   Contact? @relation("Human", fields: [contactId], references: [id])
  ${field}
${attribute}
  @@base(Actor, "human")
}`;

      expect(diagnosticsOf(schema)).toEqual([
        expect.objectContaining({
          code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
          message: `Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance), so "${form}" cannot be stored there, and a one-to-one relation from a single-table variant is not supported yet.`,
          span: expect.objectContaining({
            start: expect.objectContaining({
              offset: schema.indexOf(form === '@unique' ? '@unique' : '@@unique'),
            }),
          }),
        }),
      ]);
    },
  );

  it.each([
    {
      case: 'an index type other than the derived one',
      relation: '',
      attribute: '@@index([contactId], type: "hash", options: {})',
    },
    {
      case: 'a relation that derives no index',
      relation: ', index: false',
      attribute: '@@index([contactId])',
    },
  ])(
    "refuses a plain index on the variant's foreign key columns with $case",
    ({ relation, attribute }) => {
      const schema = [
        contact,
        actor,
        humanWithContact(`  ${attribute}`).replace(
          'onDelete: Cascade)',
          `onDelete: Cascade${relation})`,
        ),
      ].join('\n\n');

      expect(diagnosticsOf(schema)).toContainEqual(
        expect.objectContaining({
          code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
          span: expect.objectContaining({
            start: expect.objectContaining({ offset: schema.indexOf(attribute) }),
          }),
        }),
      );
    },
  );

  const twoVariantsIndexing = (humanMap: string, botMap: string) =>
    [
      contactOf('  bots BotActor[] @relation("Bot")'),
      actor,
      humanWithContact(`  @@index([contactId], map: "${humanMap}")`),
      botWithOwner('Contact').replace(
        '\n\n  @@base',
        `\n  @@index([contactId], map: "${botMap}")\n  @@base`,
      ),
    ].join('\n\n');

  it('keeps one index when two variants write the same backing index', () => {
    const tables = tablesOf(twoVariantsIndexing('actor_contact', 'actor_contact'));

    expect(tables['actor']?.indexes).toMatchObject([
      { columns: ['contactId'], name: 'actor_contact' },
    ]);
  });

  it('refuses a second variant that names the same backing index differently', () => {
    const schema = twoVariantsIndexing('actor_contact', 'actor_owner');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
        span: expect.objectContaining({
          start: expect.objectContaining({
            offset: schema.indexOf('@@index([contactId], map: "actor_owner")'),
          }),
        }),
      }),
    ]);
  });

  it('words a conflict with the base model without calling the base a variant', () => {
    const schema = `${contact}

${team}

model Actor {
  id        Int    @id
  kind      String
  team      Team?  @relation("Bot", fields: [contactId], references: [id])
  contactId Int?

  @@discriminator(kind)
  @@map("actor")
}

${humanWithContact('')}`.replace(
      'bots BotActor[] @relation("Bot")',
      'actors Actor[] @relation("Bot")',
    );

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance) and declares a foreign key on (contactId) that differs from the one "Actor" declares there. Every row would have to satisfy both; keep only one of the two relations.',
      }),
    ]);
  });

  it('reports only the missing discriminator when the base has none', () => {
    const diagnostics = diagnosticsOf(`model Actor {
  id   Int    @id
  kind String

  @@map("actor")
}

model HumanActor {
  email String?

  @@unique([email])
  @@base(Actor, "human")
}`);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['PSL_ORPHANED_BASE']);
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
