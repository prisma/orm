import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { canonicalInet } from '../src/core/canonical-inet';

const spellings = [
  '10.0.0.1/32',
  '10.0.0.1',
  '10.0.0.1/24',
  '10.0.0.0/8',
  '10/8',
  '10/9',
  '10/16',
  '10.1/16',
  '10',
  '10.',
  '10.0.0.1.',
  '10./8',
  '010.000.000.001',
  '10.0.0.256',
  '10.0.0.1/33',
  '10.0.0.1/08',
  '10.0.0.1/0',
  '10.0.0.1/',
  '10.0.0.1/32/1',
  '1.2.3.4.5',
  '0x0a.0.0.1',
  ' 10.0.0.1',
  '10.0.0.1 ',
  '1.2.3.4:80',
  '0.0.0.0/0',
  '255.255.255.255',
  '::FFFF:10.0.0.1',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  '::ffff:0:0',
  '::0:ffff:1.2.3.4',
  '::fffe:1.2.3.4',
  '::ffff:1.2',
  '::1.2.3',
  '::1..2',
  '::ffff:010.0.0.1',
  '::ffff:1.2.3.4/96',
  '::ffff:1.2.3.4/08',
  '::1.2.3.4.5',
  '::1.2.3.4:5',
  '64:ff9b::1.2.3.4',
  '1:2:3:4:5:6:1.2.3.4',
  '1:2:3:4:5:6:7:1.2.3.4',
  '::1',
  '::2',
  '::',
  '::/0',
  '::1/128',
  '::1/64',
  '::1/0',
  '::1/00',
  '::1/08',
  '::10.0.0.1',
  '::0.0.0.1',
  '0:0:0:0:0:0:0:1',
  '0:0:0:0:0:0:1:0',
  '0:0:0:0:0:1:0:0',
  '0:0:0:0:ffff:0:0:1',
  '1:0:0:0:0:0:0:0',
  '0:1:0:0:0:0:0:0',
  '1:0:0:1:0:0:0:1',
  '1:0:0:0:1:0:0:1',
  '1:0:1:0:1:0:1:0',
  '1:0:0:1:0:0:1:1',
  '::1:0:0:0',
  '2001:DB8::1',
  '2001:0db8:0000:0000:0000:0000:0000:0001',
  '2001:db8::',
  '2001:db8:0:0:1::',
  '2001:db8::1/64',
  '2001:db8::/129',
  'ABCD:EF01:2345:6789:ABCD:EF01:2345:6789',
  '1:2:3:4:5:6:7:8',
  '1:2:3:4:5:6:7::',
  '::2:3:4:5:6:7:8',
  '1::3:4:5:6:7:8',
  '1:2:3:4:5:6:7:8:9',
  '1:2:3:4:5:6:7:8::',
  '::1:2:3:4:5:6:7:8',
  '0000::1',
  '00000::1',
  '1::2::3',
  ':1::',
  '1:',
  ':::',
  'fe80::1%eth0',
  'not an address',
  '',
];

describe('canonicalInet against Postgres', () => {
  it(
    'rewrites exactly the spellings Postgres reads as an inet into the text Postgres prints, and refuses the rest',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, async (client) => {
          const printedOrRefused: Record<string, string | undefined> = {};
          for (const spelling of spellings) {
            printedOrRefused[spelling] = await client
              .query<{ printed: string }>({
                text: 'SELECT $1::inet AS printed',
                values: [spelling],
                types: { getTypeParser: () => (text: string) => text },
              })
              .then(
                (result) => result.rows[0]?.printed ?? '',
                () => undefined,
              );
          }
          expect(
            Object.fromEntries(spellings.map((spelling) => [spelling, canonicalInet(spelling)])),
          ).toEqual(printedOrRefused);
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
