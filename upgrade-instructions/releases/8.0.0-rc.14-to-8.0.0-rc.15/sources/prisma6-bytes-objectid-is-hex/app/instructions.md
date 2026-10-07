---
changes:
  - id: prisma6-bytes-objectid-is-hex
    summary: |
      A Prisma 6 MongoDB schema with a native type Prisma 6 accepts now emits with `prisma6Schema(...)`
      (only `DateTime @db.Timestamp` is still refused). A `Bytes @db.ObjectId` field holds an ObjectId, so
      Prisma 8 reads it as a 24-digit hex string and writes only a hex string or an ObjectId; a 12-byte
      `Buffer` or `Uint8Array`, which the Prisma 6 client uses for it, is refused.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\bBytes(?:\[\])?\??[ \t]+[^\n]*@db\.ObjectId\b'
---

# A Prisma 6 `Bytes @db.ObjectId` is a hex string

Before this release, `prisma6Schema(...)` refused every native type other than `String @db.ObjectId`. It now reads each native type Prisma 6 accepts on MongoDB as the codec for the BSON type Prisma 6 stores. Only `DateTime @db.Timestamp` is still refused.

A `Bytes @db.ObjectId` field stores an ObjectId, so Prisma 8 treats it like `String @db.ObjectId`: reads return the 24-digit hex string, and writes take a hex string or an ObjectId. The Prisma 6 client uses 12 bytes for the same field, and Prisma 8 refuses a `Buffer` or `Uint8Array` there.

Where application code that moves to the Prisma 8 client passes or reads such a field, convert at the boundary:

- bytes to the hex string Prisma 8 takes: `bytes.toString('hex')` for a `Buffer`, `Buffer.from(bytes).toString('hex')` for a `Uint8Array`
- the hex string Prisma 8 returns to bytes: `Buffer.from(hex, 'hex')`

The stored values do not change: Prisma 6 and Prisma 8 read and write the same ObjectId.
