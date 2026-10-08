/**
 * The `inet` text PostgreSQL reads and the text it prints, so the contract can hold an address the
 * way the database reports it.
 *
 * Both directions follow PostgreSQL's own `inet_net_pton` and `inet_net_ntop` (`src/port`), quirks
 * included, because a spelling the database reads differently, or prints differently, is a default
 * that fails `db verify` or an enum member no value read back equals. The tests compare every rule
 * with PostgreSQL's output.
 */

interface InetValue {
  /** Four bytes for IPv4, sixteen for IPv6. */
  readonly bytes: readonly number[];
  readonly bits: number;
}

const DIGIT = /^[0-9]$/;
const HEX_DIGIT = /^[0-9a-fA-F]$/;

const isDigit = (ch: string | undefined): ch is string => ch !== undefined && DIGIT.test(ch);

/**
 * Text PostgreSQL reads as an `inet` value, written the way PostgreSQL prints it: an IPv4 address in
 * four decimal octets, an IPv6 address in lower-case hex with its longest run of zero groups written
 * `::`, and the prefix length only when it is shorter than the whole address. `undefined` for text
 * PostgreSQL does not read as an `inet` value.
 */
export function canonicalInet(text: string): string | undefined {
  if (text.includes(':')) {
    const value = readIpv6(text);
    return value === undefined ? undefined : printIpv6(value);
  }
  const value = readIpv4(text);
  return value === undefined ? undefined : printIpv4(value);
}

/**
 * PostgreSQL's `inet_net_pton_ipv4`: one to four decimal octets, each up to 255 and leading zeros
 * allowed, then an optional `/` and prefix length up to 32. Without a prefix length all four octets
 * are required; with one, the octets written must cover it.
 */
function readIpv4(text: string): InetValue | undefined {
  const octets: number[] = [];
  let index = 0;
  let ch = text[index++];
  while (isDigit(ch)) {
    let octet = 0;
    do {
      octet = octet * 10 + Number(ch);
      if (octet > 255) return undefined;
      ch = text[index++];
    } while (isDigit(ch));
    if (octets.length === 4) return undefined;
    octets.push(octet);
    if (ch === undefined || ch === '/') break;
    if (ch !== '.') return undefined;
    ch = text[index++];
  }

  let bits = -1;
  if (ch === '/' && isDigit(text[index]) && octets.length > 0) {
    ch = text[index++];
    bits = 0;
    do {
      bits = bits * 10 + Number(ch);
      ch = text[index++];
    } while (isDigit(ch));
    if (ch !== undefined || bits > 32) return undefined;
  }
  if (ch !== undefined) return undefined;
  if (bits === -1) {
    if (octets.length !== 4) return undefined;
    bits = 32;
  }
  if (octets.length === 0 || Math.floor(bits / 8) > octets.length) return undefined;
  return { bytes: [...octets, 0, 0, 0, 0].slice(0, 4), bits };
}

/** PostgreSQL's `getbits`: a prefix length up to 128, with no leading zero. */
function readBits(text: string): number | undefined {
  let bits = 0;
  let digits = 0;
  for (const ch of text) {
    if (!isDigit(ch)) return undefined;
    if (digits++ !== 0 && bits === 0) return undefined;
    bits = bits * 10 + Number(ch);
    if (bits > 128) return undefined;
  }
  return digits === 0 ? undefined : bits;
}

/**
 * PostgreSQL's `getv4`, for the IPv4 tail of an IPv6 address: up to four decimal octets with no
 * leading zeros, and an optional prefix length. Octets left out are zero.
 */
function readIpv4Tail(
  text: string,
): { readonly octets: readonly number[]; readonly bits: number | undefined } | undefined {
  const octets: number[] = [];
  let octet = 0;
  let digits = 0;
  for (const [index, ch] of [...text].entries()) {
    if (isDigit(ch)) {
      if (digits++ !== 0 && octet === 0) return undefined;
      octet = octet * 10 + Number(ch);
      if (octet > 255) return undefined;
      continue;
    }
    if (ch !== '.' && ch !== '/') return undefined;
    if (octets.length > 3) return undefined;
    octets.push(octet);
    if (ch === '/') {
      const bits = readBits(text.slice(index + 1));
      return bits === undefined ? undefined : { octets, bits };
    }
    octet = 0;
    digits = 0;
  }
  if (digits === 0 || octets.length > 3) return undefined;
  return { octets: [...octets, octet], bits: undefined };
}

/**
 * PostgreSQL's `inet_cidr_pton_ipv6`: up to eight groups of one to four hex digits in either case,
 * one `::` standing for a run of zero groups, an optional IPv4 tail, and an optional prefix length.
 */
function readIpv6(text: string): InetValue | undefined {
  const bytes = new Array<number>(16).fill(0);
  let filled = 0;
  let compressedAt: number | undefined;
  let index = 0;
  if (text[0] === ':') {
    if (text[1] !== ':') return undefined;
    index = 1;
  }
  let tokenStart = index;
  let sawHexDigit = false;
  let group = 0;
  let groupDigits = 0;
  let bits = 128;

  while (index < text.length) {
    const ch = text[index++] ?? '';
    if (HEX_DIGIT.test(ch)) {
      group = (group << 4) | Number.parseInt(ch, 16);
      if (++groupDigits > 4) return undefined;
      sawHexDigit = true;
      continue;
    }
    if (ch === ':') {
      tokenStart = index;
      if (!sawHexDigit) {
        if (compressedAt !== undefined) return undefined;
        compressedAt = filled;
        continue;
      }
      if (index >= text.length || filled + 2 > 16) return undefined;
      bytes[filled++] = group >> 8;
      bytes[filled++] = group & 0xff;
      sawHexDigit = false;
      group = 0;
      groupDigits = 0;
      continue;
    }
    if (ch === '.' && filled + 4 <= 16) {
      const tail = readIpv4Tail(text.slice(tokenStart));
      if (tail !== undefined) {
        tail.octets.forEach((octet, offset) => {
          bytes[filled + offset] = octet;
        });
        filled += 4;
        sawHexDigit = false;
        bits = tail.bits ?? bits;
        break;
      }
    }
    if (ch === '/') {
      const prefix = readBits(text.slice(index));
      if (prefix !== undefined) {
        bits = prefix;
        break;
      }
    }
    return undefined;
  }

  if (sawHexDigit) {
    if (filled + 2 > 16) return undefined;
    bytes[filled++] = group >> 8;
    bytes[filled++] = group & 0xff;
  }
  if (compressedAt !== undefined) {
    if (filled === 16) return undefined;
    const shifted = bytes.slice(compressedAt, filled);
    bytes.fill(0, compressedAt, filled);
    bytes.splice(16 - shifted.length, shifted.length, ...shifted);
    filled = 16;
  }
  return filled === 16 ? { bytes, bits } : undefined;
}

function printIpv4({ bytes, bits }: InetValue): string {
  const address = bytes.join('.');
  return bits === 32 ? address : `${address}/${bits}`;
}

/**
 * PostgreSQL's `inet_net_ntop_ipv6`: the first longest run of two or more zero groups is written
 * `::`, and an address whose first five groups are zero followed by `ffff`, or whose first six are
 * zero, ends in dotted IPv4.
 */
function printIpv6({ bytes, bits }: InetValue): string {
  const groups = Array.from(
    { length: 8 },
    (_, i) => ((bytes[2 * i] ?? 0) << 8) | (bytes[2 * i + 1] ?? 0),
  );
  const zeroRun = longestZeroRun(groups);
  let text = '';
  for (let i = 0; i < 8; i++) {
    if (zeroRun !== undefined && i >= zeroRun.start && i < zeroRun.start + zeroRun.length) {
      if (i === zeroRun.start) text += ':';
      continue;
    }
    if (i !== 0) text += ':';
    const ipv4Tail =
      i === 6 &&
      zeroRun?.start === 0 &&
      (zeroRun.length === 6 || (zeroRun.length === 5 && groups[5] === 0xffff));
    if (ipv4Tail) {
      text += bytes.slice(12).join('.');
      break;
    }
    text += (groups[i] ?? 0).toString(16);
  }
  if (zeroRun !== undefined && zeroRun.start + zeroRun.length === 8) text += ':';
  return bits === 128 ? text : `${text}/${bits}`;
}

function longestZeroRun(
  groups: readonly number[],
): { readonly start: number; readonly length: number } | undefined {
  let best: { start: number; length: number } | undefined;
  let current: { start: number; length: number } | undefined;
  for (const [i, group] of groups.entries()) {
    if (group === 0) {
      current =
        current === undefined
          ? { start: i, length: 1 }
          : { ...current, length: current.length + 1 };
      continue;
    }
    if (current !== undefined && (best === undefined || current.length > best.length))
      best = current;
    current = undefined;
  }
  if (current !== undefined && (best === undefined || current.length > best.length)) best = current;
  return best !== undefined && best.length >= 2 ? best : undefined;
}
