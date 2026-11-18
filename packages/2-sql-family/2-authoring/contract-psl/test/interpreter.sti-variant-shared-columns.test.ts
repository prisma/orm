import { describe, expect, it } from 'vitest';
import {
  actor,
  botWithOwner,
  contactOf,
  diagnosticsOf,
  humanWithContact,
  tablesOf,
} from './sti-variant-support';

const contactWithBots = contactOf('  bots BotActor[] @relation("Bot")');

const plainBot = (extra = '') => `model BotActor {
  contactId Int?${extra}

  @@base(Actor, "bot")
}`;

const tenantSchema = (humanColumns: string, botColumns: string) => `model Team {
  tenantId Int
  id       Int
  bots     BotActor[]

  @@id([tenantId, id])
  @@map("team")
}

model Person {
  tenantId Int
  id       Int
  humans   HumanActor[]

  @@id([tenantId, id])
  @@map("person")
}

${actor}

model HumanActor {
  tenantId Int
  ownerId  Int
  owner    Person @relation(fields: [${humanColumns}], references: [${humanColumns === 'tenantId, ownerId' ? 'tenantId, id' : 'id, tenantId'}])

  @@base(Actor, "human")
}

model BotActor {
  tenantId Int
  ownerId  Int
  team     Team @relation(fields: [${botColumns}], references: [${botColumns === 'tenantId, ownerId' ? 'tenantId, id' : 'id, tenantId'}])

  @@base(Actor, "bot")
}`;

describe('a single-table variant column another model of the table also maps', () => {
  it('refuses a variant foreign key on a column a sibling maps as a plain field', () => {
    const schema = [contactOf(''), actor, humanWithContact(''), plainBot()].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "HumanActor" declares a foreign key on (contactId), but "BotActor" also maps column "contactId" in the table of "Actor" without it (single-table inheritance). Every "BotActor" row would have to satisfy it; give the field of "HumanActor" its own column with @map.',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('@relation("Human", fields') }),
        }),
      }),
    ]);
  });

  it('refuses a variant foreign key on a column the base model maps as a plain field', () => {
    const schema = [
      contactOf(''),
      actor.replace('kind String', 'kind      String\n  contactId Int?'),
      humanWithContact(''),
    ].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT',
        message:
          'Model "HumanActor" declares a foreign key on (contactId), but its base model "Actor" also maps column "contactId" without it (single-table inheritance). Every row of "Actor" would have to satisfy it; give the field of "HumanActor" its own column with @map.',
      }),
    ]);
  });

  it('names only the shared column of a foreign key over several columns', () => {
    const schema = tenantSchema('tenantId, ownerId', 'tenantId, ownerId')
      .replace(
        `model BotActor {
  tenantId Int
  ownerId  Int
  team     Team @relation(fields: [tenantId, ownerId], references: [tenantId, id])`,
        `model BotActor {
  ownerId  Int`,
      )
      .replace('  bots     BotActor[]\n', '');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        message:
          'Model "HumanActor" declares a foreign key on (tenantId, ownerId), but "BotActor" also maps column "ownerId" in the table of "Actor" without it (single-table inheritance). Every "BotActor" row would have to satisfy it; give the field of "HumanActor" its own column with @map.',
      }),
    ]);
  });

  it('refuses a unique on a shared foreign key column that the other variant does not declare', () => {
    const schema = [
      contactWithBots,
      actor,
      humanWithContact('').replace('contactId Int', 'contactId Int    @unique'),
      botWithOwner('Contact'),
    ].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('@unique') }),
        }),
      }),
    ]);
  });

  it('accepts a unique on a shared foreign key column when both variants declare it', () => {
    const tables = tablesOf(
      [
        contactWithBots,
        actor,
        humanWithContact('').replace('contactId Int', 'contactId Int    @unique'),
        botWithOwner('Contact').replace('contactId Int', 'contactId Int @unique'),
      ].join('\n\n'),
    );

    expect(tables['actor']?.uniques).toMatchObject([{ columns: ['contactId'] }]);
  });

  it('tells a one-to-one relation to give its field its own column instead of a partial index', () => {
    const schema = `model Contact {
  id    Int         @id
  human HumanActor? @relation("Human")
  bots  BotActor[]  @relation("Bot")

  @@map("contact")
}

${actor}

model HumanActor {
  contact   Contact? @relation("Human", fields: [contactId], references: [id])
  contactId Int?     @unique

  @@base(Actor, "human")
}

model BotActor {
  owner     Contact? @relation("Bot", fields: [contactId], references: [id])
  contactId Int?

  @@base(Actor, "bot")
}`;

    expect(diagnosticsOf(schema)).toContainEqual(
      expect.objectContaining({
        code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
        message:
          'Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance), and "BotActor" also maps column "contactId" without this unique. A one-to-one relation needs the unique, so give the field of "HumanActor" its own column with @map.',
      }),
    );
  });

  it('refuses foreign keys over the same columns in another order to different targets', () => {
    expect(diagnosticsOf(tenantSchema('tenantId, ownerId', 'ownerId, tenantId'))).toContainEqual(
      expect.objectContaining({ code: 'PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT' }),
    );
  });

  it('refuses a variant backing index the base already declares under another name', () => {
    const schema = [
      contactOf('  actors Actor[]'),
      actor
        .replace(
          'kind String',
          'kind      String\n  contact   Contact? @relation(fields: [contactId], references: [id], onDelete: Cascade)\n  contactId Int?',
        )
        .replace(
          '@@discriminator(kind)',
          '@@index([contactId], map: "actor_contact")\n  @@discriminator(kind)',
        ),
      humanWithContact('  @@index([contactId], map: "human_contact")'),
    ].join('\n\n');

    expect(diagnosticsOf(schema)).toEqual([
      expect.objectContaining({
        code: 'PSL_UNSCOPED_INDEX_ON_STI_VARIANT',
        message:
          'Model "HumanActor" shares the table of its base model "Actor" (single-table inheritance), and "Actor" already declares this index there under another name. Give both the same name.',
        span: expect.objectContaining({
          start: expect.objectContaining({
            offset: schema.indexOf('@@index([contactId], map: "human_contact")'),
          }),
        }),
      }),
    ]);
  });

  it('places each refusal on the attribute that wrote it, a mixin attribute included', () => {
    const schema = `${contactOf('')}

${actor}

model mixin Nicknamed {
  nickname String?

  @@index([nickname])
}

model HumanActor {
  contact   Contact @relation("Human", fields: [contactId], references: [id])
  contactId Int
  email     String? @unique
  +Nicknamed

  @@index([email])
  @@base(Actor, "human")
}

${plainBot()}`;
    const offsets = (texts: readonly string[]) => texts.map((text) => schema.indexOf(text));

    expect(
      diagnosticsOf(schema)
        .map((diagnostic) => diagnostic.span?.start.offset)
        .sort((left, right) => (left ?? 0) - (right ?? 0)),
    ).toEqual(
      offsets(['@@index([nickname])', '@relation("Human", fields', '@unique', '@@index([email])']),
    );
  });

  it('keeps one partial index when two variants write it with and without an explicit unique: false', () => {
    const partial =
      '@@index([contactId], where: sql`kind <> \'robot\'`, name: "actor_live_contact"';
    const tables = tablesOf(
      [
        contactWithBots,
        actor,
        humanWithContact(`  ${partial})`),
        botWithOwner('Contact').replace('\n\n  @@base', `\n  ${partial}, unique: false)\n  @@base`),
      ].join('\n\n'),
    );

    expect(tables['actor']?.indexes.filter((index) => index.where !== undefined)).toHaveLength(1);
  });

  it('quotes a discriminator column that is not a plain lower-case name in the advice', () => {
    const mapped = actor.replace('kind String', 'kind String @map("actorKind")');

    expect(
      diagnosticsOf([contactOf(''), mapped, humanWithContact('  @@unique([email])')].join('\n\n')),
    ).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('where: sql`"actorKind" = \'human\'`'),
      }),
    ]);
  });
});
