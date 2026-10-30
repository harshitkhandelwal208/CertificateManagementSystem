import fs from 'node:fs/promises'
import path from 'node:path'
import { query } from './db'

function validPath(filePath: string) {
  if (!/^(templates|certificates)\/[a-zA-Z0-9_.-]+$/.test(filePath)) throw new Error('Invalid runtime file path')
  return filePath
}
export async function readRuntimeFile(filePath: string): Promise<Buffer | null> {
  validPath(filePath)
  const [row] = await query<{ content: Buffer }>('SELECT content FROM runtime_files WHERE path = $1', [filePath])
  return row?.content ?? null
}
export async function writeRuntimeFile(filePath: string, content: Uint8Array | string): Promise<void> {
  validPath(filePath)
  await query('INSERT INTO runtime_files(path, content, updated_at) VALUES ($1, $2, $3) ON CONFLICT(path) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at', [filePath, Buffer.from(content), new Date().toISOString()])
}
// The database is authoritative; the local copy only supports the signing CLI.
export async function cacheRuntimeFile(filePath: string): Promise<boolean> {
  const bytes = await readRuntimeFile(filePath)
  if (!bytes) return false
  const target = path.join(process.env.DATA_DIR || path.resolve('data'), validPath(filePath))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, bytes)
  return true
}
