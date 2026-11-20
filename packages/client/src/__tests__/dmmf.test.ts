import { stripVTControlCharacters } from 'node:util'

import { getDMMF } from '@prisma/internals'

describe('dmmf', () => {
  test('dmmf enum filter mysql', async () => {
    const datamodel = `
      datasource db {
        provider = "mysql"
      }
      
      model User {
        id Int @id @default(autoincrement())
        name String
        email String @unique
        kind PostKind
      }
      
      enum PostKind {
        NICE
        AWESOME
      }`

    const dmmf = await getDMMF({ datamodel })
    expect(dmmf.schema.inputObjectTypes.prisma.find((i) => i.name === 'NestedEnumPostKindFilter'))
      .toMatchInlineSnapshot(`
      {
        "constraints": {
          "maxNumFields": null,
          "minNumFields": null,
        },
        "fields": [
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "EnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "equals",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "in",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "notIn",
          },
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "inputObjectTypes",
                "namespace": "prisma",
                "type": "NestedEnumPostKindFilter",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "not",
          },
        ],
        "name": "NestedEnumPostKindFilter",
      }
    `)
    expect(dmmf.schema.inputObjectTypes.prisma.find((i) => i.name === 'EnumPostKindFilter')).toMatchInlineSnapshot(`
      {
        "constraints": {
          "maxNumFields": null,
          "minNumFields": null,
        },
        "fields": [
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "EnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "equals",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "in",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "notIn",
          },
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "inputObjectTypes",
                "namespace": "prisma",
                "type": "NestedEnumPostKindFilter",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "not",
          },
        ],
        "name": "EnumPostKindFilter",
      }
    `)
  })

  test('dmmf enum filter postgresql', async () => {
    const datamodel = `
      datasource db {
        provider = "postgresql"
      }
      
      model User {
        id Int @id @default(autoincrement())
        name String
        email String @unique
        kind PostKind
      }
      
      enum PostKind {
        NICE
        AWESOME
      }`

    const dmmf = await getDMMF({ datamodel })
    expect(dmmf.schema.inputObjectTypes.prisma.find((i) => i.name === 'NestedEnumPostKindFilter'))
      .toMatchInlineSnapshot(`
      {
        "constraints": {
          "maxNumFields": null,
          "minNumFields": null,
        },
        "fields": [
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "EnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "equals",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "ListEnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "in",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "ListEnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "notIn",
          },
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "inputObjectTypes",
                "namespace": "prisma",
                "type": "NestedEnumPostKindFilter",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "not",
          },
        ],
        "name": "NestedEnumPostKindFilter",
      }
    `)
    expect(dmmf.schema.inputObjectTypes.prisma.find((i) => i.name === 'EnumPostKindFilter')).toMatchInlineSnapshot(`
      {
        "constraints": {
          "maxNumFields": null,
          "minNumFields": null,
        },
        "fields": [
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "EnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "equals",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "ListEnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "in",
          },
          {
            "inputTypes": [
              {
                "isList": true,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "fieldRefTypes",
                "namespace": "prisma",
                "type": "ListEnumPostKindFieldRefInput",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "notIn",
          },
          {
            "inputTypes": [
              {
                "isList": false,
                "location": "enumTypes",
                "namespace": "model",
                "type": "PostKind",
              },
              {
                "isList": false,
                "location": "inputObjectTypes",
                "namespace": "prisma",
                "type": "NestedEnumPostKindFilter",
              },
            ],
            "isNullable": false,
            "isParameterizable": true,
            "isRequired": false,
            "name": "not",
          },
        ],
        "name": "EnumPostKindFilter",
      }
    `)
  })

  test('dmmf enum should fail on sqlite', async () => {
    const datamodel = `
      datasource db {
        provider = "sqlite"
      }

      model User {
        id Int @id @default(autoincrement())
        name String
        email String @unique
        kind PostKind
      }

      enum PostKind {
        NICE
        AWESOME
      }`

    try {
      await getDMMF({ datamodel })
    } catch (e) {
      expect(stripVTControlCharacters(e.message)).toMatchInlineSnapshot(`
        "Prisma schema validation - (get-dmmf wasm)
        Error code: P1012
        error: Error validating: You defined the enum \`PostKind\`. But the current connector does not support enums.
          -->  schema.prisma:14
           | 
        13 | 
        14 |       enum PostKind {
        15 |         NICE
        16 |         AWESOME
        17 |       }
           | 

        Validation Error Count: 1
        [Context: getDmmf]

        Prisma CLI Version : 0.0.0"
      `)
    }
  })
})
