import fs from 'fs-extra'

import { FilesResolver, FsEntryType } from './types'

export const realFsResolver: FilesResolver = {
  listDirContents(path: string): Promise<string[]> {
    return fs.readdir(path)
  },
  async getEntryType(path: string): Promise<FsEntryType> {
    const stat = await fs.lstat(path)
    if (stat.isFile()) {
      return { kind: 'file' }
    }

    if (stat.isDirectory()) {
      return { kind: 'directory', realPath: await fs.realpath(path) }
    }

    if (stat.isSymbolicLink()) {
      return { kind: 'symlink', realPath: await fs.realpath(path) }
    }
    return { kind: 'other' }
  },

  getFileContents(path: string): Promise<string> {
    return fs.readFile(path, 'utf8')
  },
}
