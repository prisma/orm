import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { planFieldEventOperations } from '../src/core/migrations/field-event-planner';
import type { CodecControlHooks } from '../src/core/migrations/types';
import { col, contract, makeOp, recordingHook, table } from './field-event-fixtures';

describe('planFieldEventOperations', () => {
  it("fires 'added' once per added field on the new field's codec", () => {
    const fromContract = contract({
      User: table({ id: col({ codecId: 'pg/text@1' }) }),
    });
    const newContract = contract({
      User: table({
        id: col({ codecId: 'pg/text@1' }),
        email: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook([makeOp('add-search-config-User-email')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls).toEqual([
      {
        event: 'added',
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'User',
        fieldName: 'email',
        priorCodecId: undefined,
        newCodecId: 'cs/string@1',
        priorTablePresent: false,
        newTablePresent: true,
      },
    ]);
    expect(ops.map((o) => (o.toOp() as MigrationPlanOperation).id)).toEqual([
      'add-search-config-User-email',
    ]);
  });

  it("fires 'dropped' once per dropped field on the prior field's codec", () => {
    const fromContract = contract({
      User: table({
        id: col({ codecId: 'pg/text@1' }),
        email: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      User: table({ id: col({ codecId: 'pg/text@1' }) }),
    });

    const cs = recordingHook([makeOp('remove-search-config-User-email')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls).toEqual([
      {
        event: 'dropped',
        namespaceId: UNBOUND_NAMESPACE_ID,
        tableName: 'User',
        fieldName: 'email',
        priorCodecId: 'cs/string@1',
        newCodecId: undefined,
        priorTablePresent: true,
        newTablePresent: false,
      },
    ]);
    expect(ops.map((o) => (o.toOp() as MigrationPlanOperation).id)).toEqual([
      'remove-search-config-User-email',
    ]);
  });

  it("fires 'altered' when nullable changes", () => {
    const fromContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1', nullable: true }) }),
    });
    const newContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1', nullable: false }) }),
    });

    const cs = recordingHook([makeOp('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls).toHaveLength(1);
    expect(cs.calls[0]?.event).toBe('altered');
    expect(cs.calls[0]?.priorTablePresent).toBe(true);
    expect(cs.calls[0]?.newTablePresent).toBe(true);
    expect(ops).toHaveLength(1);
  });

  it("fires 'altered' when typeParams change", () => {
    const fromContract = contract({
      User: table({
        email: col({ codecId: 'cs/string@1', typeParams: { searchable: false } }),
      }),
    });
    const newContract = contract({
      User: table({
        email: col({ codecId: 'cs/string@1', typeParams: { searchable: true } }),
      }),
    });

    const cs = recordingHook([makeOp('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['altered']);
    expect(ops).toHaveLength(1);
  });

  it("fires 'altered' when the default value changes", () => {
    const fromContract = contract({
      User: table({
        flag: col({ codecId: 'cs/string@1', default: { kind: 'literal', value: 'a' } }),
      }),
    });
    const newContract = contract({
      User: table({
        flag: col({ codecId: 'cs/string@1', default: { kind: 'literal', value: 'b' } }),
      }),
    });

    const cs = recordingHook([makeOp('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['altered']);
    expect(ops).toHaveLength(1);
  });

  it("does not fire 'altered' when only codecId changes", () => {
    const fromContract = contract({
      User: table({ email: col({ codecId: 'pg/text@1' }) }),
    });
    const newContract = contract({
      User: table({ email: col({ codecId: 'pg/varchar@1' }) }),
    });

    const text = recordingHook([makeOp('text')]);
    const varchar = recordingHook([makeOp('varchar')]);
    const codecHooks = new Map<string, CodecControlHooks>([
      ['pg/text@1', text.hook],
      ['pg/varchar@1', varchar.hook],
    ]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(text.calls).toHaveLength(0);
    expect(varchar.calls).toHaveLength(0);
    expect(ops).toHaveLength(0);
  });

  it("does not fire 'altered' on a no-op diff (fields byte-equal)", () => {
    const same = contract({
      User: table({ email: col({ codecId: 'cs/string@1', nullable: false }) }),
    });

    const cs = recordingHook([makeOp('rotate')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: same,
      newContract: same,
      codecHooks,
      renames: [],
    });

    expect(cs.calls).toHaveLength(0);
    expect(ops).toHaveLength(0);
  });

  it('treats a missing prior contract as "everything is added"', () => {
    const newContract = contract({
      User: table({
        id: col({ codecId: 'pg/text@1' }),
        email: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook([makeOp('add-search-config')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: null,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['added']);
    expect(cs.calls[0]?.tableName).toBe('User');
    expect(cs.calls[0]?.fieldName).toBe('email');
    expect(ops).toHaveLength(1);
  });

  it('does nothing when the codec has no onFieldEvent hook', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'pg/text@1' }) }),
    });

    const codecHooks = new Map<string, CodecControlHooks>([
      ['pg/text@1', { planTypeOperations: () => ({ operations: [] }) }],
    ]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(ops).toHaveLength(0);
  });

  it('does nothing when no hook is registered for the field codec', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'pg/text@1' }) }),
    });

    const codecHooks = new Map<string, CodecControlHooks>();

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(ops).toHaveLength(0);
  });

  it('returns the hook ops in the order the hook returned them', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1' }) }),
    });

    const cs = recordingHook([makeOp('first'), makeOp('second'), makeOp('third')]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(ops.map((o) => (o.toOp() as MigrationPlanOperation).id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('returns an empty list when the hook returns an empty array', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({ email: col({ codecId: 'cs/string@1' }) }),
    });

    const cs = recordingHook([]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls).toHaveLength(1);
    expect(ops).toHaveLength(0);
  });

  it('groups events deterministically: added → dropped → altered', () => {
    const fromContract = contract({
      User: table({
        toAlter: col({ codecId: 'cs/string@1', nullable: true }),
        toDrop: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      User: table({
        toAdd: col({ codecId: 'cs/string@1' }),
        toAlter: col({ codecId: 'cs/string@1', nullable: false }),
      }),
    });

    const cs = recordingHook((call) => [makeOp(`${call.event}:${call.fieldName}`)]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls.map((c) => c.event)).toEqual(['added', 'dropped', 'altered']);
    expect(ops.map((o) => (o.toOp() as MigrationPlanOperation).id)).toEqual([
      'added:toAdd',
      'dropped:toDrop',
      'altered:toAlter',
    ]);
  });

  it('orders events within a group alphabetically by (namespaceId, tableName, fieldName)', () => {
    const fromContract = contract({});
    const newContract = contract({
      Beta: table({
        zeta: col({ codecId: 'cs/string@1' }),
        alpha: col({ codecId: 'cs/string@1' }),
      }),
      Alpha: table({
        beta: col({ codecId: 'cs/string@1' }),
        zeta: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook((_call) => []);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls.map((c) => `${c.tableName}.${c.fieldName}`)).toEqual([
      'Alpha.beta',
      'Alpha.zeta',
      'Beta.alpha',
      'Beta.zeta',
    ]);
  });

  it('routes each event to the codec that owns the field, not other codecs', () => {
    const fromContract = contract({ User: table({}) });
    const newContract = contract({
      User: table({
        secret: col({ codecId: 'cs/string@1' }),
        plain: col({ codecId: 'pg/text@1' }),
      }),
    });

    const cs = recordingHook([makeOp('cs-add')]);
    const pg = recordingHook([makeOp('pg-add')]);
    const codecHooks = new Map<string, CodecControlHooks>([
      ['cs/string@1', cs.hook],
      ['pg/text@1', pg.hook],
    ]);

    planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(cs.calls.map((c) => c.fieldName)).toEqual(['secret']);
    expect(pg.calls.map((c) => c.fieldName)).toEqual(['plain']);
  });

  it('produces byte-stable output across repeated calls (deterministic ordering)', () => {
    const fromContract = contract({
      User: table({
        toAlter: col({ codecId: 'cs/string@1', nullable: true }),
        toDrop: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      Post: table({ body: col({ codecId: 'cs/string@1' }) }),
      User: table({
        toAdd: col({ codecId: 'cs/string@1' }),
        toAlter: col({ codecId: 'cs/string@1', nullable: false }),
      }),
    });

    const codecHooks = new Map<string, CodecControlHooks>([
      [
        'cs/string@1',
        {
          onFieldEvent: (event, ctx) => [makeOp(`op-${event}-${ctx.tableName}-${ctx.fieldName}`)],
        },
      ],
    ]);

    const opsA = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });
    const opsB = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    // Materialise each `OpFactoryCall` rather than `JSON.stringify`-ing
    // the array — function members like `toOp` / `renderTypeScript` get
    // silently dropped by stringify, which would mask determinism drift
    // in exactly the surfaces this test is meant to lock down.
    expect(opsA.map((c) => c.toOp())).toEqual(opsB.map((c) => c.toOp()));
    expect(opsA.map((c) => c.renderTypeScript())).toEqual(opsB.map((c) => c.renderTypeScript()));
    expect(opsA.map((c) => c.factoryName)).toEqual(opsB.map((c) => c.factoryName));
  });

  it('handles whole-table additions and drops by treating each field as its own event', () => {
    const fromContract = contract({
      Drop: table({
        a: col({ codecId: 'cs/string@1' }),
        b: col({ codecId: 'cs/string@1' }),
      }),
    });
    const newContract = contract({
      Add: table({
        x: col({ codecId: 'cs/string@1' }),
        y: col({ codecId: 'cs/string@1' }),
      }),
    });

    const cs = recordingHook((call) => [
      makeOp(`${call.event}:${call.tableName}.${call.fieldName}`),
    ]);
    const codecHooks = new Map<string, CodecControlHooks>([['cs/string@1', cs.hook]]);

    const ops = planFieldEventOperations({
      priorContract: fromContract,
      newContract,
      codecHooks,
      renames: [],
    });

    expect(ops.map((o) => (o.toOp() as MigrationPlanOperation).id)).toEqual([
      'added:Add.x',
      'added:Add.y',
      'dropped:Drop.a',
      'dropped:Drop.b',
    ]);
  });
});
