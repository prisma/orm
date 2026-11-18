import pgvector from '@prisma/orm-extension-pgvector/runtime';
import postgres from '@prisma/orm-postgres/runtime';
import { contract } from '../../prisma/contract';

// No-emit flow: hand the TypeScript-authored contract straight to the
// `postgres()` facade with deferred binding (no url at construction). The
// facade owns stack/context/sql/enums, so the demo no longer hand-wires them.
export const db = postgres<typeof contract>({ contract, extensions: [pgvector] });

export const context = db.context;
export const stack = db.stack;
export const enums = db.enums;
export const sql = db.sql.public;
