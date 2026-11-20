import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { createGunzip } from 'node:zlib'

import { select } from '@inquirer/prompts'
import { dim } from 'kleur/colors'

import { CURATED_TEMPLATES } from './template-definitions'

const PRISMA_EXAMPLES_TARBALL_URL = 'https://api.github.com/repos/prisma/prisma-examples/tarball/latest'

export async function promptTemplateSelection(): Promise<string> {
  return select({
    message: 'Pick a starter template:',
    choices: CURATED_TEMPLATES.map((t) => ({
      name: `${t.label}  ${dim(`prisma-examples/orm/${t.name}`)}`,
      value: t.name,
    })),
    loop: true,
  })
}

export function isValidTemplateName(name: string): boolean {
  return CURATED_TEMPLATES.some((t) => t.name === name)
}

/**
 * Downloads the prisma-examples tarball and extracts only `orm/<templateName>/`
 * into `targetDir`. Buffers the decompressed tar and walks it entry-by-entry.
 *
 * The prisma-examples tarball is typically <10 MB decompressed, so buffering
 * is acceptable and avoids a streaming tar parser dependency.
 */
export async function downloadAndExtractTemplate(templateName: string, targetDir: string): Promise<void> {
  const response = await fetch(PRISMA_EXAMPLES_TARBALL_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'prisma-cli' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download template: HTTP ${response.status}`)
  }

  const tarBuffer = await decompressGzip(response.body as import('node:stream/web').ReadableStream)
  const templatePrefix = `orm/${templateName}/`
  let filesExtracted = 0

  let offset = 0
  while (offset + 512 <= tarBuffer.length) {
    const header = parseTarHeader(tarBuffer, offset)
    if (!header) break

    offset += 512
    const paddedSize = Math.ceil(header.size / 512) * 512

    if (header.type === '0' || header.type === '') {
      const relPath = stripFirstComponent(header.name)
      if (relPath?.startsWith(templatePrefix)) {
        const destPath = path.resolve(targetDir, relPath.slice(templatePrefix.length))
        if (!destPath.startsWith(path.resolve(targetDir) + path.sep)) continue
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, tarBuffer.subarray(offset, offset + header.size))
        filesExtracted++
      }
    }

    offset += paddedSize
  }

  if (filesExtracted === 0) {
    throw new Error(`Template "${templateName}" not found in prisma-examples repository`)
  }

  const packageJsonPath = path.join(targetDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(
      `Template "${templateName}" extracted ${filesExtracted} file(s) but is missing package.json — the download may be corrupted`,
    )
  }
}

async function decompressGzip(body: import('node:stream/web').ReadableStream): Promise<Buffer> {
  const gunzip = createGunzip()
  const nodeStream = Readable.fromWeb(body)
  const chunks: Buffer[] = []

  return new Promise<Buffer>((resolve, reject) => {
    nodeStream.on('error', reject)
    nodeStream
      .pipe(gunzip)
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject)
  })
}

interface TarEntry {
  name: string
  size: number
  type: string
}

function parseTarHeader(buf: Buffer, offset: number): TarEntry | null {
  const header = buf.subarray(offset, offset + 512)
  if (header.every((b) => b === 0)) return null

  const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '')
  const sizeStr = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim()
  const typeFlag = header[156]
  const type = typeFlag === 0 ? '0' : String.fromCharCode(typeFlag)
  const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0.*$/, '')

  const fullName = prefix ? `${prefix}/${name}` : name
  const size = sizeStr ? parseInt(sizeStr, 8) : 0

  if (isNaN(size)) return null

  return { name: fullName, size, type }
}

/**
 * GitHub tarballs add a `<owner>-<repo>-<sha>/` prefix to all paths.
 */
function stripFirstComponent(filePath: string): string | null {
  const idx = filePath.indexOf('/')
  if (idx === -1) return null
  return filePath.slice(idx + 1)
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno'

export function detectPackageManager(baseDir: string): PackageManager {
  if (fs.existsSync(path.join(baseDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(baseDir, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(baseDir, 'bun.lock')) || fs.existsSync(path.join(baseDir, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(baseDir, 'deno.lock'))) return 'deno'

  const pkgPath = path.join(baseDir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const pm = pkg.packageManager as string | undefined
      if (pm) {
        if (pm.startsWith('pnpm')) return 'pnpm'
        if (pm.startsWith('yarn')) return 'yarn'
        if (pm.startsWith('bun')) return 'bun'
        if (pm.startsWith('deno')) return 'deno'
      }
    } catch {}
  }

  return 'npm'
}

const execFileAsync = promisify(execFile)

async function runPackageManager(baseDir: string, args: string[]): Promise<void> {
  const pm = detectPackageManager(baseDir)
  await execFileAsync(pm, args, {
    cwd: baseDir,
    env: { ...process.env },
    shell: process.platform === 'win32',
    timeout: 300_000,
  })
}

export function installDependencies(baseDir: string): Promise<void> {
  return runPackageManager(baseDir, ['install'])
}

function addArgsForPackages(baseDir: string, packages: string[], dev: boolean): string[] {
  const pm = detectPackageManager(baseDir)
  if (pm === 'deno') {
    throw new Error('Deno projects require manual dependency management. Please add dependencies to your deno.json.')
  }
  switch (pm) {
    case 'npm':
      return dev ? ['install', '--save-dev', ...packages] : ['install', ...packages]
    case 'yarn':
      return dev ? ['add', '--dev', ...packages] : ['add', ...packages]
    default:
      return dev ? ['add', '-D', ...packages] : ['add', ...packages]
  }
}

export function addDependencies(baseDir: string, packages: string[]): Promise<void> {
  return runPackageManager(baseDir, addArgsForPackages(baseDir, packages, false))
}

export function addDevDependencies(baseDir: string, packages: string[]): Promise<void> {
  return runPackageManager(baseDir, addArgsForPackages(baseDir, packages, true))
}
