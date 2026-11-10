import { EventEmitter } from 'node:events';
import type { Connection } from 'pg';
import { describe, expect, it } from 'vitest';
import { NamedCursor } from '../src/named-cursor';

interface RecordedMessage {
  readonly kind: 'parse' | 'bind' | 'describe' | 'flush';
  readonly opts?: unknown;
}

class MockConnection extends EventEmitter {
  parsedStatements: Record<string, string> = {};
  readonly messages: RecordedMessage[] = [];

  parse(opts: { text: string; name?: string }): void {
    this.messages.push({ kind: 'parse', opts });
  }

  bind(opts: { portal: string; statement?: string; values: readonly unknown[] }): void {
    this.messages.push({ kind: 'bind', opts });
  }

  describe(opts: { type: 'P' | 'S'; name: string }): void {
    this.messages.push({ kind: 'describe', opts });
  }

  flush(): void {
    this.messages.push({ kind: 'flush' });
  }
}

function submitTo(cursor: NamedCursor<unknown>, conn: MockConnection): void {
  // The mock only implements the Connection methods that submit() calls.
  cursor.submit(conn as unknown as Connection);
}

describe('NamedCursor.submit', () => {
  it('sends Parse with the configured name when not in connection.parsedStatements', () => {
    const conn = new MockConnection();
    const cursor = new NamedCursor({ name: 'pn_1', text: 'select 1', values: [] });

    submitTo(cursor, conn);

    expect(conn.messages.map((m) => m.kind)).toEqual(['parse', 'bind', 'describe', 'flush']);
    const parse = conn.messages[0]?.opts as { name: string; text: string; types: unknown[] };
    expect(parse).toMatchObject({ name: 'pn_1', text: 'select 1' });
    expect(parse.types).toEqual([]);
  });

  it('skips Parse when the name is already in connection.parsedStatements', () => {
    const conn = new MockConnection();
    conn.parsedStatements['pn_1'] = 'select 1';
    const cursor = new NamedCursor({ name: 'pn_1', text: 'select 1', values: [] });

    submitTo(cursor, conn);

    expect(conn.messages.map((m) => m.kind)).toEqual(['bind', 'describe', 'flush']);
  });

  it('Bind references the named statement', () => {
    const conn = new MockConnection();
    const cursor = new NamedCursor({ name: 'pn_42', text: 'select 1', values: [] });

    submitTo(cursor, conn);

    const bind = conn.messages.find((m) => m.kind === 'bind')?.opts as {
      portal: string;
      statement?: string;
    };
    expect(bind.statement).toBe('pn_42');
    // Portals are per-cursor so concurrent cursors don't collide.
    expect(bind.portal).toMatch(/^np_\d+$/);
  });

  it('passes prepareValue-mapped values into Bind', () => {
    const conn = new MockConnection();
    const cursor = new NamedCursor({ name: 'pn_1', text: 'select 1', values: [42, null, 'x'] });

    submitTo(cursor, conn);

    const bind = conn.messages.find((m) => m.kind === 'bind')?.opts as {
      values: ReadonlyArray<unknown>;
    };
    expect(bind.values).toEqual(['42', null, 'x']);
  });
});
