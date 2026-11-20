import { Decimal } from '@prisma/client-runtime-utils'
import path from 'path'

import { getTestClient } from '../../../../utils/getTestClient'
import { tearDownPostgres } from '../../../../utils/setupPostgres'
import { migrateDb } from '../../__helpers__/migrateDb'

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.TEST_POSTGRES_URI!.replace('tests', 'tests-native-types-tests')
  await tearDownPostgres(process.env.DATABASE_URL)
  await migrateDb({
    schemaPath: path.join(__dirname, 'schema.prisma'),
  })
})

test('native-types-postgres A: Integer, SmallInt, BigInt, Serial, SmallSerial, BigSerial', async () => {
  const PrismaClient = await getTestClient()

  const prisma = new PrismaClient()

  await prisma.a.deleteMany()

  let data = {
    email: 'a@a.de',
    name: 'Bob',
    int: 1,
    sInt: 3,
    bInt: BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2),
  }

  let a = await prisma.a.create({
    data,
    select: {
      email: true,
      name: true,
      int: true,
      sInt: true,
      bInt: true,
    },
  })

  expect(data).toEqual(a)

  data = {
    email: 'a2@a.de',
    name: 'Bob',
    int: -1,
    sInt: -3,
    bInt: BigInt(-12312312),
  }

  a = await prisma.a.create({
    data,
    select: {
      email: true,
      name: true,
      int: true,
      sInt: true,
      bInt: true,
    },
  })

  expect(data).toEqual(a)

  await prisma.$disconnect()
})

test('native-types-postgres B: Real, DoublePrecision, Decimal, Numeric', async () => {
  const PrismaClient = await getTestClient()

  const prisma = new PrismaClient()

  await prisma.b.deleteMany()

  let data: any = {
    float: 1.1,
    dFloat: 1.3,
    decFloat: 0,
    numFloat: '-23.12',
    decArray: [1.1, 2.5],
  }

  let b = await prisma.b.create({
    data,
    select: {
      float: true,
      dFloat: true,
      decFloat: true,
      numFloat: true,
      decArray: true,
    },
  })

  expect(Decimal.isDecimal(b.float)).toBe(false)
  expect(Decimal.isDecimal(b.dFloat)).toBe(false)
  expect(Decimal.isDecimal(b.decFloat)).toBe(true)
  expect(Decimal.isDecimal(b.numFloat)).toBe(true)

  const mappedData = {
    float: 1.1,
    dFloat: 1.3,
    decFloat: new Decimal(0),
    numFloat: new Decimal('-23.12'),
    decArray: [new Decimal(1.1), new Decimal(2.5)],
  }

  expect(b).toEqual(mappedData)

  data = {
    float: 1,
    dFloat: 1.3,
    decFloat: new Decimal('1.2'),
    numFloat: new Decimal('1232.123456'),
  }

  b = await prisma.b.create({
    data,
    select: {
      float: true,
      dFloat: true,
      decFloat: true,
      numFloat: true,
    },
  })

  expect(b).toEqual(data)

  await prisma.$disconnect()
})

test('native-types-postgres C: Char, VarChar, Text, Bit, VarBit, Uuid', async () => {
  const PrismaClient = await getTestClient()

  const prisma = new PrismaClient()

  await prisma.c.deleteMany()

  const data = {
    char: 'hello',
    vChar: 'world',
    text: 'a text',
    bit: '1001',
    vBit: '10110',
    uuid: '643547a7-9e32-4e63-a52c-2e229f301c62',
  }

  const c = await prisma.c.create({
    data,
    select: {
      char: true,
      vChar: true,
      text: true,
      bit: true,
      vBit: true,
      uuid: true,
    },
  })

  expect(c).toMatchInlineSnapshot(`
    {
      bit: 1001,
      char: hello     ,
      text: a text,
      uuid: 643547a7-9e32-4e63-a52c-2e229f301c62,
      vBit: 10110,
      vChar: world,
    }
  `)

  await prisma.$disconnect()
})

test('native-types-postgres D: Boolean, Bytes, Json, JsonB', async () => {
  const PrismaClient = await getTestClient()

  const prisma = new PrismaClient()

  await prisma.d.deleteMany()

  const helloString = 'hello prisma ⚡️🚀'

  const binaryString = (s: string) => new Uint8Array(Buffer.from(s))

  const data = {
    bool: true,
    byteA: binaryString(helloString),
    json: { hello: 'world' },
    jsonb: { hello: 'world' },
    xml: '',
    bytesArray: [binaryString(helloString), binaryString(helloString)],
  }
  const d = await prisma.d.create({
    data,
    select: {
      bool: true,
      byteA: true,
      json: true,
      jsonb: true,
      xml: true,
      bytesArray: true,
    },
  })

  expect(ArrayBuffer.isView(d.byteA)).toBe(true)

  expect(d).toEqual(data)

  await prisma.$disconnect()
})

test('native-types-postgres E: Date, Time, Timestamp', async () => {
  const PrismaClient = await getTestClient()

  const prisma = new PrismaClient()

  await prisma.e.deleteMany()

  const data = {
    date: new Date('2020-05-05T16:28:33.983Z'),
    time: new Date('2020-05-02T16:28:33.983Z'),
    ts: '2020-05-05T16:28:33.983+03:00',
  }

  const e = await prisma.e.create({
    data,
    select: {
      date: true,
      time: true,
      ts: true,
    },
  })

  expect(e).toMatchInlineSnapshot(`
    {
      date: 2020-05-05T00:00:00.000Z,
      time: 1970-01-01T16:28:33.983Z,
      ts: 2020-05-05T13:28:33.983Z,
    }
  `)

  await prisma.$disconnect()
})
