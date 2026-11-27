import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** One 512-byte tar header. `name` and `prefix` are written as given, without splitting. */
export function tarHeader({ name, size = 0, type = '0', prefix = '', linkname = '' }) {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, 'utf-8');
  block.write(octal(0o644, 8), 100);
  block.write(octal(0, 8), 108);
  block.write(octal(0, 8), 116);
  block.write(octal(size, 12), 124);
  block.write(octal(0, 12), 136);
  block.write('        ', 148);
  block.write(type, 156);
  block.write(linkname, 157, 100, 'utf-8');
  block.write('ustar\0', 257);
  block.write('00', 263);
  block.write(prefix, 345, 155, 'utf-8');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

export function padded(content) {
  const rest = content.length % 512;
  return rest === 0 ? content : Buffer.concat([content, Buffer.alloc(512 - rest)]);
}

export function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (Buffer.byteLength(`${length}${body}`) !== length) length++;
  return `${length}${body}`;
}

/** A tar entry for a regular file; paths over 100 bytes get a pax header, as npm's packer writes. */
export function fileEntry(path, text) {
  const content = Buffer.from(text, 'utf-8');
  const blocks = [];
  if (Buffer.byteLength(path) > 100) {
    const pax = Buffer.from(paxRecord('path', path), 'utf-8');
    blocks.push(tarHeader({ name: 'PaxHeader/long', size: pax.length, type: 'x' }), padded(pax));
  }
  blocks.push(tarHeader({ name: path, size: content.length }), padded(content));
  return Buffer.concat(blocks);
}

export function archive(entries) {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

/** A gzipped package tarball holding `files`, each under `package/`. */
export function tarball(files) {
  return gzipSync(
    archive(Object.entries(files).map(([name, text]) => fileEntry(`package/${name}`, text))),
  );
}

export function integrityOf(content) {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`;
}

export function shasumOf(content) {
  return createHash('sha1').update(content).digest('hex');
}
