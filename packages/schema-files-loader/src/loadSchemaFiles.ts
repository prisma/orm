import path from 'node:path'

import { FilesResolver, FsEntryType, realFsResolver } from './resolver'

export type LoadedFile = [filePath: string, content: string]

/**
 * Given folder name, returns list of all files composing a single prisma schema
 * @param folderPath
 */
export async function loadSchemaFiles(
  folderPath: string,
  filesResolver: FilesResolver = realFsResolver,
): Promise<LoadedFile[]> {
  const type = await filesResolver.getEntryType(folderPath)
  return processEntry(folderPath, type, filesResolver)
}

async function processEntry(
  entryPath: string,
  entryType: FsEntryType | undefined,
  filesResolver: FilesResolver,
  visitedDirs: Set<string> = new Set(),
): Promise<LoadedFile[]> {
  if (!entryType) {
    return []
  }
  if (entryType.kind === 'symlink') {
    const realPath = entryType.realPath
    const realType = await filesResolver.getEntryType(realPath)
    return processEntry(realPath, realType, filesResolver, visitedDirs)
  }

  if (entryType.kind === 'file') {
    if (path.extname(entryPath) !== '.prisma') {
      return []
    }
    const content = await filesResolver.getFileContents(entryPath)
    if (typeof content === 'undefined') {
      return []
    }
    return [[entryPath, content]]
  }

  if (entryType.kind === 'directory') {
    // Symlinks pointing to directories are followed, so a directory that is
    // reachable from itself would otherwise be traversed forever. The canonical
    // path is used for tracking, since the same directory can be reached under
    // different paths.
    const dirId = entryType.realPath ?? entryPath
    if (visitedDirs.has(dirId)) {
      return []
    }
    visitedDirs.add(dirId)

    const dirEntries = await filesResolver.listDirContents(entryPath)
    const nested = await Promise.all(
      dirEntries.map(async (dirEntry) => {
        const fullPath = path.join(entryPath, dirEntry)
        const nestedEntryType = await filesResolver.getEntryType(fullPath)
        return processEntry(fullPath, nestedEntryType, filesResolver, visitedDirs)
      }),
    )
    return nested.flat()
  }

  return []
}
