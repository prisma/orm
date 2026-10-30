import type { RuntimeDriverInstance } from '@internal/framework-components/execution';
import type { MongoDriver } from '@internal/mongo-lowering';
import type { AnyMongoDdlWireCommand, AnyMongoDmlWireCommand } from '@internal/mongo-wire';
import { structuredError } from '@internal/utils/structured-error';
import type { MongoClient } from 'mongodb';
import { MongoDriverImpl } from '../../mongo-driver';

/** What a Mongo runtime driver connects to. The driver closes a client it creates from `url`, and leaves a caller's `mongoClient` open. */
export type MongoBinding =
  | { readonly kind: 'url'; readonly url: string; readonly dbName: string }
  | {
      readonly kind: 'mongoClient';
      readonly client: MongoClient;
      readonly dbName: string;
    };

export type MongoRuntimeDriver = RuntimeDriverInstance<'mongo', 'mongo'> &
  MongoDriver<MongoBinding>;

type DisconnectedState = 'unbound' | 'closed';

const notConnectedMessages: Record<DisconnectedState, string> = {
  unbound: 'Mongo driver not connected. Call connect(binding) before execute or run.',
  closed: 'Mongo driver is closed. Call connect(binding) to reconnect.',
};

const ALREADY_CONNECTED_MESSAGE =
  'Mongo driver already connected. Call close() before reconnecting with a new binding.';

async function connectedDriver(binding: MongoBinding): Promise<MongoDriverImpl> {
  if (binding.kind === 'mongoClient') {
    return MongoDriverImpl.fromDb(binding.client.db(binding.dbName));
  }
  return MongoDriverImpl.fromConnection(binding.url, binding.dbName);
}

class MongoUnboundDriverImpl implements MongoRuntimeDriver {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;

  #delegate: MongoDriverImpl | null = null;
  #connecting: Promise<MongoDriverImpl> | null = null;
  #disconnectedState: DisconnectedState = 'unbound';

  #notConnectedError(): Error {
    return structuredError('DRIVER.NOT_CONNECTED', notConnectedMessages[this.#disconnectedState]);
  }

  #requireDelegate(): MongoDriverImpl {
    if (this.#delegate === null) {
      throw this.#notConnectedError();
    }
    return this.#delegate;
  }

  async connect(binding: MongoBinding): Promise<void> {
    if (this.#delegate !== null || this.#connecting !== null) {
      throw structuredError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        meta: { bindingKind: binding.kind },
      });
    }
    const connecting = connectedDriver(binding);
    this.#connecting = connecting;
    try {
      const delegate = await connecting;
      if (this.#connecting !== connecting) {
        throw this.#notConnectedError();
      }
      this.#delegate = delegate;
      this.#disconnectedState = 'unbound';
    } finally {
      if (this.#connecting === connecting) {
        this.#connecting = null;
      }
    }
  }

  async *execute<Row = Record<string, unknown>>(
    wireCommand: AnyMongoDmlWireCommand,
  ): AsyncIterable<Row> {
    yield* this.#requireDelegate().execute<Row>(wireCommand);
  }

  async run(wireCommand: AnyMongoDdlWireCommand): Promise<void> {
    return this.#requireDelegate().run(wireCommand);
  }

  async close(): Promise<void> {
    const delegate = this.#delegate;
    const connecting = this.#connecting;
    this.#delegate = null;
    this.#connecting = null;
    this.#disconnectedState = 'closed';
    const connected = await connecting?.catch(() => null);
    await Promise.all([delegate?.close(), connected?.close()]);
  }
}

export function createMongoRuntimeDriver(): MongoRuntimeDriver {
  return new MongoUnboundDriverImpl();
}
