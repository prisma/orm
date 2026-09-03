import type { Bit, Char, VarBit, Varchar } from '@internal/target-postgres/codec-types';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract } from './_fixture/other/generated/contract';
import contractJson from './_fixture/other/generated/contract.json' with { type: 'json' };
import type { Contract as StringContract } from './_fixture/string/generated/contract';
import stringContractJson from './_fixture/string/generated/contract.json' with { type: 'json' };

describe('ports/engines/queries/data_types/native/postgres', () => {
  it(
    'native_string',
    () =>
      withPostgresPort<StringContract>({ contractJson: stringContractJson }, async ({ db }) => {
        await db.public.Parent.create({
          id: 1,
          child: (child) =>
            child.create({
              id: 1,
              char: '1234567890' as Char<10>,
              vChar: '12345678910' as Varchar<11>,
              text: 'text',
              bit: '1010' as Bit<4>,
              vBit: '00110' as VarBit<5>,
              uuid: '123e4567-e89b-12d3-a456-426614174000',
              ip: '127.0.0.1',
            }),
        });

        const result = await db.public.Parent.select('id')
          .include('child', (child) =>
            child.select('char', 'vChar', 'text', 'bit', 'vBit', 'uuid', 'ip'),
          )
          .all();
        expect(result).toEqual([
          {
            id: 1,
            child: {
              char: '1234567890',
              vChar: '12345678910',
              text: 'text',
              bit: '1010',
              vBit: '00110',
              uuid: '123e4567-e89b-12d3-a456-426614174000',
              ip: '127.0.0.1',
            },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'native_other_types',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.Child.create({
          id: 1,
          bool: true,
          byteA: Uint8Array.from(Buffer.from('dGVzdA==', 'base64')),
          json: {},
          jsonb: { a: 'b' },
        });
        await db.public.Parent.create({ id: 1, childId: 1 });

        const result = await db.public.Parent.include('child', (child) =>
          child.select('id', 'bool', 'byteA', 'json', 'jsonb'),
        )
          .select('id')
          .all();
        expect(result).toEqual([
          {
            id: 1,
            child: {
              id: 1,
              bool: true,
              byteA: Uint8Array.from(Buffer.from('dGVzdA==', 'base64')),
              json: {},
              jsonb: { a: 'b' },
            },
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
