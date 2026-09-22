import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat as printPslFromSql } from '../fixtures';

describe('printPsl', () => {
  it('schema with defaults (autoincrement, now, boolean, string, number)', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        post: {
          name: 'post',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'function', expression: 'autoincrement()' } as unknown as string,
            },
            title: {
              name: 'title',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'literal', value: 'Untitled' } as unknown as string,
            },
            is_published: {
              name: 'is_published',
              nativeType: 'bool',
              nullable: false,
              default: { kind: 'literal', value: false } as unknown as string,
            },
            view_count: {
              name: 'view_count',
              nativeType: 'int4',
              nullable: false,
              default: { kind: 'literal', value: 0 } as unknown as string,
            },
            created_at: {
              name: 'created_at',
              nativeType: 'timestamptz',
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
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Post {
        id          Int         @id @default(autoincrement())
        title       String      @default("Untitled")
        isPublished Boolean     @default(false) @map("is_published")
        viewCount   Int         @default(0) @map("view_count")
        createdAt   Timestamptz @default(now()) @map("created_at")

        @@map("post")
      }
      "
    `);
  });

  it('prints parameterized native constructors in field position', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        contact: {
          name: 'contact',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: {
              name: 'email',
              nativeType: 'character varying(255)',
              nullable: false,
            },
            phone: {
              name: 'phone',
              nativeType: 'character(20)',
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
    const result = printPslFromSql(schemaIR);
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

  it('prints each native constructor independently of column-name collisions', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        price: {
          name: 'price',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            value: {
              name: 'value',
              nativeType: 'numeric(10,2)',
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
            id: { name: 'id', nativeType: 'int4', nullable: false },
            value: {
              name: 'value',
              nativeType: 'character varying(255)',
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
    const result = printPslFromSql(schemaIR);
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

  it('prints repeated native constructors directly on each field', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: {
              name: 'email',
              nativeType: 'character varying(255)',
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
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: {
              name: 'email',
              nativeType: 'character varying(255)',
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

    const result = printPslFromSql(schemaIR);
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

  it('does not alias native constructors that share scalar or model names', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user: {
              name: 'user',
              nativeType: 'character varying(255)',
              nullable: false,
            },
            string: {
              name: 'string',
              nativeType: 'character varying(64)',
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

    const result = printPslFromSql(schemaIR);
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

  it('unsupported (unmappable) types', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        geo_data: {
          name: 'geo_data',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            location: {
              name: 'location',
              nativeType: 'geometry',
              nullable: true,
            },
            metadata: {
              name: 'metadata',
              nativeType: 'hstore',
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
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model GeoData {
        id       Int                      @id
        location Unsupported("geometry")?
        metadata Unsupported("hstore")

        @@map("geo_data")
      }
      "
    `);
  });

  it('uuid default', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        item: {
          name: 'item',
          columns: {
            id: {
              name: 'id',
              nativeType: 'uuid',
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
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Item {
        id Uuid @id @default(dbgenerated("gen_random_uuid()"))

        @@map("item")
      }
      "
    `);
  });

  it('preserves non-default native types in field position', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        schedule: {
          name: 'schedule',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            booked_on: {
              name: 'booked_on',
              nativeType: 'date',
              nullable: false,
            },
            slot: {
              name: 'slot',
              nativeType: 'time(3)',
              nullable: false,
            },
            rating: {
              name: 'rating',
              nativeType: 'int2',
              nullable: false,
            },
            payload: {
              name: 'payload',
              nativeType: 'json',
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

    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Schedule {
        id       Uuid     @id
        bookedOn Date     @map("booked_on")
        slot     Time(3)
        rating   SmallInt
        payload  Json

        @@map("schedule")
      }
      "
    `);
  });

  it('preserves raw Postgres defaults via dbgenerated attributes', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        data: {
          name: 'data',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            computed: {
              name: 'computed',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'function', expression: 'my_custom_func()' } as unknown as string,
            },
            payload: {
              name: 'payload',
              nativeType: 'jsonb',
              nullable: false,
              default: "'{}'::jsonb",
            },
            touched_at: {
              name: 'touched_at',
              nativeType: 'timestamptz',
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
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Data {
        id        Int         @id
        computed  String      @default(dbgenerated("my_custom_func()"))
        payload   Jsonb       @default(json\`{}\`)
        touchedAt Timestamptz @default(dbgenerated("clock_timestamp()")) @map("touched_at")

        @@map("data")
      }
      "
    `);
  });
});
