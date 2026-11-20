import fs from 'node:fs'
import path from 'node:path'

export function getFiles(dir: string): Array<{ name: string; size: number }> {
  const files = fs.readdirSync(dir, 'utf8')
  return files.map((name) => {
    const size = fs.statSync(path.join(dir, name)).size

    return { name, size }
  })
}
