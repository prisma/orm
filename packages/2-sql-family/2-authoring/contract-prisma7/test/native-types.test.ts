import { describe, expect, it } from 'vitest';
import {
  interpretSchemaText,
  interpretSchemaTextResult,
  loadFixtureTable,
  serializedTable,
} from './support';

describe('native types without arguments', () => {
  it('reads @db.Char with no length as character(1), the column Postgres creates for CHAR', async () => {
    const table = await loadFixtureTable('native-types-without-arguments', 'NativeTypes');
    expect(table.columns['char']).toMatchObject({
      dataType: 'pg/char',
      typeParams: { length: 1 },
    });
  });
});

describe('native type arguments', () => {
  const schema = (attribute: string) => `datasource db {
  provider = "postgresql"
}

model Account {
  id   Int    @id
  name String ${attribute}
}
`;

  function diagnosticsOf(attribute: string) {
    const result = interpretSchemaTextResult(schema(attribute));
    if (result.ok) throw new Error('expected the schema to be refused');
    return result.failure.diagnostics.map(({ code, message, span }) => ({
      code,
      message,
      columns: [span?.start.column, span?.end.column],
    }));
  }

  it('reads an argument as a value of its data type, as a Prisma 8 schema does', () => {
    const table = serializedTable(interpretSchemaText(schema('@db.VarChar(255)')), 'Account');
    expect(table.columns['name']).toMatchObject({ typeParams: { length: 255 } });
  });

  it('refuses a number its data type cannot hold, at the argument', () => {
    expect(diagnosticsOf('@db.VarChar(3000000000)')).toEqual([
      {
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'Expected a number that pg/int4 can hold; got pg/int8',
        columns: [27, 37],
      },
    ]);
  });

  it('refuses a named argument with no value, at the argument', () => {
    expect(diagnosticsOf('@db.VarChar(length: )')).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: 'Field "Account.name" constructor "VarChar" named argument "length" has no value.',
        columns: [27, 34],
      },
    ]);
  });
});

describe('a native type the target does not know', () => {
  it('asks for the spelling to be corrected', () => {
    const result = interpretSchemaTextResult(`datasource db {
  provider = "postgresql"
}

model Account {
  id   Int    @id
  name String @db.Txt
}
`);
    if (result.ok) throw new Error('expected the schema to be refused');
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED',
        message:
          'Field "Account.name": native type "@db.Txt" is not one the target knows, and Prisma 7 refuses it too. Correct the spelling.',
      },
    ]);
  });
});
