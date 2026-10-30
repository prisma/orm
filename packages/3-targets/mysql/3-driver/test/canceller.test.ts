import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canceller } from '../src/core/runtime/canceller';

interface FakeCancelConnection {
  readonly query: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  valid: boolean;
  isValid(): boolean;
  on(): void;
}

const state = vi.hoisted(() => ({
  opened: [] as unknown[],
  connectFails: false,
  answer: (_sql: string): Promise<unknown> => Promise.resolve({}),
}));

function fakeConnection(): FakeCancelConnection {
  const connection: FakeCancelConnection = {
    query: vi.fn((sql: string) => state.answer(sql)),
    end: vi.fn(async () => {}),
    destroy: vi.fn(),
    valid: true,
    isValid: () => connection.valid,
    on: () => {},
  };
  return connection;
}

vi.mock('mariadb', () => ({
  createConnection: async () => {
    if (state.connectFails) throw new Error('connect ECONNREFUSED');
    const connection = fakeConnection();
    state.opened.push(connection);
    return connection;
  },
}));

function opened(index: number): FakeCancelConnection {
  const connection = state.opened[index];
  if (connection === undefined) throw new Error(`no connection ${index}`);
  return connection as FakeCancelConnection;
}

const url = 'mysql://root@localhost/db';

beforeEach(() => {
  state.opened = [];
  state.connectFails = false;
  state.answer = () => Promise.resolve({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Canceller', () => {
  it('sends KILL QUERY on one connection of its own, opened on first need and kept for later cancels', async () => {
    const canceller = new Canceller(url);
    expect([
      await canceller.cancel(41),
      await canceller.cancel(42),
      await canceller.cancel(null),
    ]).toEqual([true, true, false]);
    expect({
      opened: state.opened.length,
      sent: opened(0).query.mock.calls.map(([sql]) => sql),
    }).toEqual({ opened: 1, sent: ['KILL QUERY 41', 'KILL QUERY 42'] });
  });

  it('reports no cancel when its connection cannot be opened, and tries again next time', async () => {
    const canceller = new Canceller(url);
    state.connectFails = true;
    const first = await canceller.cancel(1);
    state.connectFails = false;
    expect({ first, second: await canceller.cancel(1), opened: state.opened.length }).toEqual({
      first: false,
      second: true,
      opened: 1,
    });
  });

  it('reports no cancel when MySQL refuses it, and keeps the connection', async () => {
    const canceller = new Canceller(url);
    state.answer = () => Promise.reject(new Error('Unknown thread id'));
    const refused = await canceller.cancel(1);
    state.answer = () => Promise.resolve({});
    expect({ refused, next: await canceller.cancel(1), opened: state.opened.length }).toEqual({
      refused: false,
      next: true,
      opened: 1,
    });
  });

  it('sets a connection aside when it is lost or no longer valid, and opens another', async () => {
    const canceller = new Canceller(url);
    state.answer = () => Promise.reject(Object.assign(new Error('socket closed'), { fatal: true }));
    const lost = await canceller.cancel(1);
    state.answer = () => Promise.resolve({});
    await canceller.cancel(1);
    opened(1).valid = false;
    await canceller.cancel(1);
    expect({ lost, opened: state.opened.length, ended: opened(0).end.mock.calls.length }).toEqual({
      lost: false,
      opened: 3,
      ended: 1,
    });
  });

  it('reports no cancel when KILL QUERY does not answer within two seconds, ends that connection without destroying it, and opens another next time', async () => {
    vi.useFakeTimers();
    const canceller = new Canceller(url);
    state.answer = () => new Promise(() => {});
    const cancelling = canceller.cancel(1);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await cancelling;
    state.answer = () => Promise.resolve({});
    const next = await canceller.cancel(1);
    expect({
      result,
      next,
      opened: state.opened.length,
      ended: opened(0).end.mock.calls.length,
      destroyed: opened(0).destroy.mock.calls.length,
    }).toEqual({ result: false, next: true, opened: 2, ended: 1, destroyed: 0 });
  });

  it('ends its connection on close, without waiting for a KILL QUERY that does not answer, and cancels nothing after', async () => {
    const canceller = new Canceller(url);
    await canceller.cancel(1);
    await canceller.close();
    const idle = opened(0).end.mock.calls.length;
    const hanging = new Canceller(url);
    state.answer = () => new Promise(() => {});
    void hanging.cancel(1);
    await vi.waitFor(() => expect(state.opened.length).toBe(2));
    await hanging.close();
    expect({
      idle,
      hanging: opened(1).end.mock.calls.length,
      after: await canceller.cancel(1),
    }).toEqual({ idle: 1, hanging: 1, after: false });
  });
});
