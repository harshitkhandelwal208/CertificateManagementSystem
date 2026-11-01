import { Pool, type PoolClient, type QueryResultRow } from 'pg'

let pool: Pool | undefined
export function getDb(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required')
    const url = new URL(connectionString)
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    // Keep certificate validation enabled even when the Neon URL uses sslmode=require.
    url.searchParams.delete('sslmode')
    pool = new Pool({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true, servername: url.hostname }, max: 3, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000, query_timeout: 30000 })
    pool.on('error', () => console.error('Idle database connection failed'))
  }
  return pool
}
export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await getDb().query<T>(sql, values)).rows
}
export async function transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
