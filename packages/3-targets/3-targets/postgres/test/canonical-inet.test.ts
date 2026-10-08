import { describe, expect, it } from 'vitest';
import { canonicalInet } from '../src/core/canonical-inet';

describe('canonicalInet', () => {
  it.each([
    ['an IPv4 host with /32', '10.0.0.1/32', '10.0.0.1'],
    ['an IPv4 host', '10.0.0.1', '10.0.0.1'],
    ['an IPv4 address with a shorter prefix', '10.0.0.1/24', '10.0.0.1/24'],
    ['an IPv4 network written in full', '10.0.0.0/8', '10.0.0.0/8'],
    ['an IPv4 network written with fewer octets', '10.1/16', '10.1.0.0/16'],
    ['IPv4 octets with leading zeros', '010.000.000.001', '10.0.0.1'],
    ['an IPv4 prefix length with a leading zero', '10.0.0.1/08', '10.0.0.1/8'],
    ['an IPv6 host with /128', '::1/128', '::1'],
    ['an IPv6 address with a prefix', '2001:DB8::1/64', '2001:db8::1/64'],
    [
      'upper-case IPv6',
      'ABCD:EF01:2345:6789:ABCD:EF01:2345:6789',
      'abcd:ef01:2345:6789:abcd:ef01:2345:6789',
    ],
    ['IPv6 written in full', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['the unspecified address', '0:0:0:0:0:0:0:0', '::'],
    ['an IPv4-mapped address in upper case', '::FFFF:10.0.0.1', '::ffff:10.0.0.1'],
    ['an IPv4-mapped address written in hex', '::ffff:a00:1', '::ffff:10.0.0.1'],
    ['an IPv4-compatible address', '::10.0.0.1', '::10.0.0.1'],
    ['a loopback written as IPv4', '::0.0.0.1', '::1'],
    ['a single zero group, which is not compressed', '1:2:3:4:5:6:7::', '1:2:3:4:5:6:7:0'],
    ['two equal runs of zeros, the first compressed', '1:0:0:1:0:0:1:1', '1::1:0:0:1:1'],
    ['a longer second run of zeros', '1:0:0:1:0:0:0:1', '1:0:0:1::1'],
    ['an embedded IPv4 that is not at a mapped position', '64:ff9b::1.2.3.4', '64:ff9b::102:304'],
    ['a partial embedded IPv4', '::ffff:1.2', '::ffff:1.2.0.0'],
  ])('writes %s as Postgres prints it', (_spelling, text, printed) => {
    expect(canonicalInet(text)).toBe(printed);
  });

  it.each([
    ['text that is not an address', 'not an address'],
    ['an empty string', ''],
    ['an IPv4 address written without all four octets and no prefix', '10'],
    ['an octet past 255', '10.0.0.256'],
    ['an IPv4 prefix past 32', '10.0.0.1/33'],
    ['a prefix that leaves out octets the prefix covers', '10/16'],
    ['a slash with no prefix', '10.0.0.1/'],
    ['surrounding spaces', ' 10.0.0.1 '],
    ['a zone', 'fe80::1%eth0'],
    ['an IPv6 prefix past 128', '2001:db8::/129'],
    ['an IPv6 prefix with a leading zero', '::1/08'],
    ['nine groups', '1:2:3:4:5:6:7:8:9'],
    ['two runs of ::', '1::2::3'],
    ['a group of five digits', '12345::1'],
    ['an embedded IPv4 octet with a leading zero', '::ffff:010.0.0.1'],
    ['a trailing colon', '1:'],
    ['a port', '1.2.3.4:80'],
  ])('returns nothing for %s, because Postgres does not read it as an inet', (_case, text) => {
    expect(canonicalInet(text)).toBeUndefined();
  });
});
