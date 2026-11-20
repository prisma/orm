export type FsEntryType =
  | {
      kind: 'file'
    }
  | {
      kind: 'directory'
      /**
       * Canonical path of the directory, if the resolver is able to provide one.
       * Used for detecting directories that are reachable from themselves through symlinks.
       */
      realPath?: string
    }
  | {
      kind: 'symlink'
      realPath: string
    }
  | { kind: 'other' }

export interface FilesResolver {
  listDirContents(path: string): Promise<string[]>

  getEntryType(path: string): Promise<FsEntryType | undefined>

  getFileContents(path: string): Promise<string | undefined>
}

export type CaseSensitivityOptions = {
  caseSensitive: boolean
}
