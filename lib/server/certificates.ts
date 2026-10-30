import crypto from "node:crypto"
import { query, transaction } from "./db"

export interface CertificateRow {
  id: number
  issuance_key: string
  public_id: string
  certificate_number: string
  event_id: string
  event_name: string
  source_id: string
  source_hash: string
  participant_name: string
  participant_email: string | null
  participant_phone: string | null
  template_id: string
  source_row_number: number
  status: string
  artifact_path: string | null
  artifact_sha256: string | null
  signer_thumbprint: string | null
  created_at: string
  issued_at: string | null
  revoked_at: string | null
  revocation_reason: string | null
}

export interface CertificateSummaryDto {
  publicId: string
  certificateNumber: string
  eventId: string
  eventName: string
  participantName: string
  participantEmail?: string | null
  participantPhone?: string | null
  templateId: string
  status: string
  createdAtUtc: string
  issuedAtUtc?: string | null
  revokedAtUtc?: string | null
  revocationReason?: string | null
  hasArtifact: boolean
  artifactSha256?: string | null
}

export interface EventSummaryDto {
  eventId: string
  eventName: string
  templateId: string
  earliestCreatedAt: string | null
  issuedCount: number
  totalCount: number
}

export interface PaginatedResult<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

function toSummaryDto(row: CertificateRow): CertificateSummaryDto {
  return {
    publicId: row.public_id,
    certificateNumber: row.certificate_number,
    eventId: row.event_id,
    eventName: row.event_name,
    participantName: row.participant_name,
    participantEmail: row.participant_email,
    participantPhone: row.participant_phone,
    templateId: row.template_id,
    status: row.status,
    createdAtUtc: row.created_at,
    issuedAtUtc: row.issued_at,
    revokedAtUtc: row.revoked_at,
    revocationReason: row.revocation_reason,
    hasArtifact: Boolean(row.artifact_path && row.artifact_sha256),
    artifactSha256: row.artifact_sha256,
  }
}

export async function getEventSummaries(): Promise<EventSummaryDto[]> {
  const rows = await query(`
    WITH all_events AS (
      SELECT event_id, event_name, template_id, created_at FROM events
      UNION ALL
      SELECT event_id, MAX(event_name), MAX(template_id), MIN(created_at)
      FROM certificates c WHERE NOT EXISTS (SELECT 1 FROM events e WHERE lower(e.event_id) = lower(c.event_id))
      GROUP BY event_id
    )
    SELECT e.event_id, e.event_name, e.template_id, e.created_at AS earliest_created_at,
           COUNT(c.id) AS total_count, SUM(CASE WHEN c.status = 'Issued' THEN 1 ELSE 0 END) AS issued_count
    FROM all_events e LEFT JOIN certificates c ON lower(c.event_id) = lower(e.event_id)
    GROUP BY e.event_id, e.event_name, e.template_id, e.created_at
    ORDER BY e.created_at DESC`)
  return rows.map(r => ({ eventId: r.event_id, eventName: r.event_name, templateId: r.template_id,
    earliestCreatedAt: r.earliest_created_at, totalCount: Number(r.total_count), issuedCount: Number(r.issued_count) }))
}

export async function getEventDetail(eventId: string, page = 1, pageSize = 50) {
  const summary = (await getEventSummaries()).find(e => e.eventId.toLowerCase() === eventId.toLowerCase())
  if (!summary) return null
  const rows = await query<CertificateRow>('SELECT * FROM certificates WHERE lower(event_id) = lower($1) ORDER BY created_at DESC LIMIT $2 OFFSET $3', [eventId, pageSize, (page - 1) * pageSize])
  return { ...summary, certificates: rows.map(toSummaryDto) }
}

export async function getCertificatesPaginated(params: { page?: number; pageSize?: number; eventId?: string | null; status?: string | null; search?: string | null }): Promise<PaginatedResult<CertificateSummaryDto>> {
  const page = params.page || 1
  const pageSize = params.pageSize || 50
  const conditions: string[] = []
  const values: unknown[] = []
  for (const field of ['eventId', 'status'] as const) {
    if (params[field]) { values.push(params[field]); conditions.push(`lower(${field === 'eventId' ? 'event_id' : 'status'}) = lower($${values.length})`) }
  }
  if (params.search) {
    values.push(`%${params.search}%`)
    conditions.push(`(participant_name ILIKE $${values.length} OR certificate_number ILIKE $${values.length} OR public_id ILIKE $${values.length} OR event_name ILIKE $${values.length} OR participant_email ILIKE $${values.length})`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [count] = await query(`SELECT COUNT(*) AS count FROM certificates ${where}`, values)
  const rows = await query<CertificateRow>(`SELECT * FROM certificates ${where} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, pageSize, (page - 1) * pageSize])
  return { items: rows.map(toSummaryDto), totalCount: Number(count.count), totalPages: Math.max(1, Math.ceil(Number(count.count) / pageSize)), page, pageSize }
}

export async function getCertificateRecordByPublicId(publicId: string): Promise<CertificateRow | null> {
  if (!/^[a-f0-9]{32}$/i.test(publicId)) return null
  const [row] = await query<CertificateRow>('SELECT * FROM certificates WHERE public_id = $1 LIMIT 1', [publicId.toLowerCase()])
  return row ?? null
}
export async function getCertificateByPublicId(publicId: string): Promise<CertificateSummaryDto | null> {
  const row = await getCertificateRecordByPublicId(publicId)
  return row ? toSummaryDto(row) : null
}
function prefix(s: string) { return `${Buffer.byteLength(s, 'utf8')}:${s}` }
export async function revokeCertificate(publicId: string, reason: string): Promise<boolean> {
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(73421001)')
    const { rows: [cert] } = await client.query('SELECT * FROM certificates WHERE public_id = $1 FOR UPDATE', [publicId])
    if (!cert) return false
    if (cert.status === 'Revoked') return true
    const occurredAt = new Date().toISOString()
    await client.query("UPDATE certificates SET status = 'Revoked', revoked_at = $1, revocation_reason = $2 WHERE id = $3", [occurredAt, reason, cert.id])
    const { rows: [head] } = await client.query('SELECT sequence, event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1')
    const sequence = Number(head?.sequence ?? 0) + 1
    const previousHash = head?.event_hash ?? 'GENESIS'
    const payload = JSON.stringify({ reason })
    const canonical = ['audit-v1', String(sequence), previousHash, occurredAt, prefix('certificate.revoked'), prefix(publicId), prefix(payload)].join('\n')
    const hash = crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase()
    await client.query('INSERT INTO audit_events(sequence, previous_hash, event_hash, occurred_at, event_type, entity_id, payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [sequence, previousHash, hash, occurredAt, 'certificate.revoked', publicId, payload])
    return true
  })
}
