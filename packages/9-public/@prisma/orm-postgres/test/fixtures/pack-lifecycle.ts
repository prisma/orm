import { spawn } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'pathe';

const phase = process.argv[2];
const socket = connect(Number(process.env['PACK_BARRIER_PORT']), '127.0.0.1');
socket.write(
  `${JSON.stringify({ label: process.env['PACK_LABEL'], phase, owner: process.env['PACK_OWNER'] })}\n`,
);
const command = await new Promise<string>((resolve, reject) => {
  let buffer = '';
  socket.on('data', (data) => {
    buffer += data.toString();
    if (buffer.includes('\n')) resolve(buffer.trim());
  });
  socket.once('error', reject);
});
socket.end();
if (command === 'orphan') {
  spawn(process.execPath, [process.argv[1]!, 'orphan'], { stdio: 'ignore' }).unref();
}
if (command !== 'continue') process.exit(1);

if (phase === 'prepack') {
  await rm('skills', { recursive: true, force: true });
  await cp('skill-source', 'skills', { recursive: true });
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { name: string };
  const skill = join('skills', 'SKILL.md');
  await writeFile(skill, (await readFile(skill, 'utf8')).replace('SOURCE', manifest.name));
}
