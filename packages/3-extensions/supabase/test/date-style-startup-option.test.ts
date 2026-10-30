import { contractFromJson } from '@internal/postgres/static';
import {
  type StartupParameterRecorder,
  startStartupParameterRecorder,
  timeouts,
} from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supabase from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

describe('a connection the Supabase client opens from a URL', () => {
  let recorder: StartupParameterRecorder;

  beforeEach(async () => {
    recorder = await startStartupParameterRecorder();
  });

  afterEach(async () => {
    await recorder.close();
  });

  it(
    'sends DateStyle=ISO and lc_monetary=C in the startup message of a connection it opens',
    async () => {
      const db = await supabase({
        contract,
        url: recorder.url,
        jwtSecret: 'fixture-jwt-signing-input-not-a-real-credential',
        verifyMarker: false,
      });
      const anon = db.asAnon();
      await anon.execute(anon.raw.sql`SELECT 1`.affectedCount().build()).catch(() => undefined);
      await db.close().catch(() => undefined);

      expect((await recorder.next())['options']).toBe('-c DateStyle=ISO -c lc_monetary=C');
    },
    timeouts.databaseOperation,
  );
});
