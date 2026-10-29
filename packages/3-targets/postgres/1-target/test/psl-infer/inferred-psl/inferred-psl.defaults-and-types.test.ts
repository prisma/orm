import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat as printPslFromSql } from '../fixtures';

describe('printPsl', () => {
  it('schema with defaults (autoincrement, now, boolean, string, number)', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: {
            id: {
              name: 'id',
              typeText: 'int4',
              nullable: false,
              default: { kind: 'function', expression: 'autoincrement()' } as unknown as string,
            },
            title: {
              name: 'title',
              typeText: 'text',
              nullable: false,
              default: { kind: 'literal', value: 'Untitled' } as unknown as string,
            },
            is_published: {
              name: 'is_published',
              typeText: 'bool',
              nullable: false,
              default: { kind: 'literal', value: false } as unknown as string,
            },
            view_count: {
              name: 'view_count',
              typeText: 'int4',
              nullable: false,
              default: { kind: 'literal', value: 0 } as unknown as string,
            },
            created_at: {
              name: 'created_at',
              typeText: 'timestamptz',
              nullable: false,
              default: { kind: 'function', expression: 'now()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Post {
        id          Int                    @id @default(autoincrement())
        title       String                 @default("Untitled")
        isPublished Boolean                @default(false) @map("is_published")
        viewCount   Int                    @default(0) @map("view_count")
        createdAt   DateTime(precision: 6) @default(now()) @map("created_at")

        @@map("post")
      }
      "
    `);
  });

  it('prints parameterized native constructors in field position', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        contact: {
          name: 'contact',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            email: {
              name: 'email',
              typeText: 'character varying(255)',
              nullable: false,
            },
            phone: {
              name: 'phone',
              typeText: 'character(20)',
              nullable: true,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
    });
    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Contact {
        id    Int          @id
        email VarChar(255) @unique
        phone Char(20)?

        @@map("contact")
      }
      "
    `);
  });

  it('prints each native constructor independently of column-name collisions', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        price: {
          name: 'price',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            value: {
              name: 'value',
              typeText: 'numeric(10,2)',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        setting: {
          name: 'setting',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            value: {
              name: 'value',
              typeText: 'character varying(255)',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Price {
        id    Int            @id
        value Numeric(10, 2)

        @@map("price")
      }

      model Setting {
        id    Int          @id
        value VarChar(255)

        @@map("setting")
      }
      "
    `);
  });

  it('prints repeated native constructors directly on each field', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            email: {
              name: 'email',
              typeText: 'character varying(255)',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        profile: {
          name: 'profile',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            email: {
              name: 'email',
              typeText: 'character varying(255)',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Account {
        id    Int          @id
        email VarChar(255)

        @@map("account")
      }

      model Profile {
        id    Int          @id
        email VarChar(255)

        @@map("profile")
      }
      "
    `);
  });

  it('does not alias native constructors that share scalar or model names', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            user: {
              name: 'user',
              typeText: 'character varying(255)',
              nullable: false,
            },
            string: {
              name: 'string',
              typeText: 'character varying(64)',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id     Int          @id
        user   VarChar(255)
        string VarChar(64)

        @@map("user")
      }
      "
    `);
  });

  it('refuses every column whose type no data type in the stack claims', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        geo_data: {
          name: 'geo_data',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            location: {
              name: 'location',
              typeText: 'geometry',
              nullable: true,
            },
            metadata: {
              name: 'metadata',
              typeText: 'hstore',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    await expect(printPslFromSql(schemaIR)).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: {
          columns: ['public.geo_data.location: geometry', 'public.geo_data.metadata: hstore'],
        },
      }),
    );
  });

  it('uuid default', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        item: {
          name: 'item',
          columns: {
            id: {
              name: 'id',
              typeText: 'uuid',
              nullable: false,
              default: { kind: 'function', expression: 'gen_random_uuid()' } as unknown as string,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Item {
        id Uuid @id @default(sql\`gen_random_uuid()\`)

        @@map("item")
      }
      "
    `);
  });

  it('preserves non-default native types in field position', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        schedule: {
          name: 'schedule',
          columns: {
            id: { name: 'id', typeText: 'uuid', nullable: false },
            booked_on: {
              name: 'booked_on',
              typeText: 'date',
              nullable: false,
            },
            slot: {
              name: 'slot',
              typeText: 'time(3)',
              nullable: false,
            },
            rating: {
              name: 'rating',
              typeText: 'int2',
              nullable: false,
            },
            payload: {
              name: 'payload',
              typeText: 'json',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Schedule {
        id       Uuid               @id
        bookedOn Date               @map("booked_on")
        slot     Time(precision: 3)
        rating   SmallInt
        payload  Json

        @@map("schedule")
      }
      "
    `);
  });

  it('preserves raw Postgres defaults as sql tagged literals', async () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        data: {
          name: 'data',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            computed: {
              name: 'computed',
              typeText: 'text',
              nullable: false,
              default: { kind: 'function', expression: 'my_custom_func()' } as unknown as string,
            },
            payload: {
              name: 'payload',
              typeText: 'jsonb',
              nullable: false,
              default: "'{}'::jsonb",
            },
            touched_at: {
              name: 'touched_at',
              typeText: 'timestamptz',
              nullable: false,
              default: 'clock_timestamp()',
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = await printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Data {
        id        Int                    @id
        computed  String                 @default(sql\`my_custom_func()\`)
        payload   Jsonb                  @default(json\`{}\`)
        touchedAt DateTime(precision: 6) @default(sql\`clock_timestamp()\`) @map("touched_at")

        @@map("data")
      }
      "
    `);
  });
});
