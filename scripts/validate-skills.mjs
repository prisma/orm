#!/usr/bin/env node
/**
 * Validates SKILL.md frontmatter across every skill root the `skills` CLI
 * and `prisma orm init` discover skills from: `skills-contrib` (contributor
 * skill sources, linted only) and the user-facing tree that `prisma-next
 * init` installs into consumer projects (`skills`). YAML must parse, and
 * `name` + `description`
 * must be non-empty strings. Also enforces the agentskills.io 1024-character
 * description limit used by `skills add` registry manifests.
 *
 * A skill whose frontmatter fails to parse is silently omitted from
 * discovery (by `skills add` or by `prisma orm init`) — this lint catches
 * that before merge.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const matter = require('gray-matter');

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const SKILLS_DIR = 'skills-contrib';
export const SKILL_ROOTS = [SKILLS_DIR, 'skills'];
export const MAX_DESCRIPTION_LENGTH = 1024;

export function validateSkillMd(content) {
  const errors = [];
  if (!/^---\s*\r?\n[\s\S]*?\r?\n---/.test(content)) {
    errors.push('missing frontmatter block');
    return errors;
  }

  let data;
  try {
    ({ data } = matter(content));
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    errors.push(`frontmatter parse error: ${message}`);
    return errors;
  }

  if (typeof data.name !== 'string' || !data.name.trim()) {
    errors.push("missing or invalid 'name' (must be a non-empty string)");
  }

  if (typeof data.description !== 'string' || !data.description.trim()) {
    errors.push("missing or invalid 'description' (must be a non-empty string)");
  } else if (data.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${data.description.length}); use a folded block scalar (description: >) or shorten the text`,
    );
  }

  // The Agent Skills spec defines `name` and `description` at the top level
  // and reserves `metadata` for everything else, as a map of strings. An
  // unquoted version stamp is the way this goes wrong in practice: YAML reads
  // `8.1` as a number, and a consumer comparing it against a package version
  // string finds no match.
  if (data.metadata !== undefined) {
    // A prototype check rather than `typeof`: YAML parses an unquoted
    // timestamp as a Date, which is object-typed but has no enumerable
    // entries, so it would sail through the per-entry check below.
    if (data.metadata === null || Object.getPrototypeOf(data.metadata) !== Object.prototype) {
      errors.push("invalid 'metadata' (must be a map of string keys to string values)");
    } else {
      for (const [key, value] of Object.entries(data.metadata)) {
        if (typeof value !== 'string') {
          errors.push(`metadata.${key} is ${typeof value}, not a string; quote the value`);
        }
      }
    }
  }

  return errors;
}

function listSkillFiles(root, skillsDir = SKILLS_DIR) {
  const base = join(root, skillsDir);
  let entries;
  try {
    entries = readdirSync(base);
  } catch {
    return [];
  }

  const files = [];
  for (const name of entries) {
    const skillDir = join(base, name);
    let skillDirStat;
    try {
      skillDirStat = statSync(skillDir);
    } catch {
      // unreadable entry (e.g. a dangling symlink) — not a skill dir
      continue;
    }
    if (!skillDirStat.isDirectory()) continue;
    const skillMd = join(skillDir, 'SKILL.md');
    try {
      if (statSync(skillMd).isFile()) {
        files.push({ dirName: name, path: skillMd });
      }
    } catch {
      // no SKILL.md in this directory
    }
  }
  return files.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

export function validateSkillFile(filePath, root) {
  const content = readFileSync(filePath, 'utf8');
  const errors = validateSkillMd(content);
  if (errors.length === 0) return null;
  return {
    file: relative(root, filePath),
    errors,
  };
}

export function runCheck({ root = repoRoot, roots = SKILL_ROOTS, files } = {}) {
  if (files?.length) {
    return files.map((file) => validateSkillFile(file, root)).filter((offence) => offence !== null);
  }

  const seen = new Set();
  const offences = [];
  for (const skillsDir of roots) {
    for (const { path } of listSkillFiles(root, skillsDir)) {
      const resolvedPath = resolve(path);
      if (seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);

      const content = readFileSync(path, 'utf8');
      const errors = validateSkillMd(content);
      if (errors.length > 0) {
        offences.push({
          file: relative(root, path),
          errors,
        });
      }
    }
  }
  return offences;
}

function main() {
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const offences = runCheck(files.length > 0 ? { files } : {});
  if (offences.length === 0) {
    console.log(`All skills passed validation (${SKILL_ROOTS.join(', ')}).`);
    return 0;
  }

  console.error('Skill validation failed:\n');
  for (const { file, errors } of offences) {
    for (const error of errors) {
      console.error(`  ${file}: ${error}`);
    }
  }
  console.error(
    '\nUnparseable frontmatter is silently skipped by `skills add` during pnpm prepare, ' +
      'and by `prisma orm init` when it installs the user-facing skills/ tree. ' +
      'Use a folded block scalar (description: >) when the description contains colons.',
  );
  return 1;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  process.exit(main());
}
