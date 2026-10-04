import { DatabaseSync } from "node:sqlite"
import path from "node:path"
import fs from "node:fs"

function getDataDirectory(): string {
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) {
    return path.resolve(process.env.DATA_DIR)
  }
  return path.resolve(process.cwd(), "data")
}

function getDatabasePath(): string {
  if (process.env.DB_PATH) {
    return path.resolve(process.env.DB_PATH)
  }
  return path.join(getDataDirectory(), "certificates.db")
}

let dbInstance: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    const dbPath = getDatabasePath()
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    dbInstance = new DatabaseSync(dbPath)
    dbInstance.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 10000;
    `)
  }
  return dbInstance
}
