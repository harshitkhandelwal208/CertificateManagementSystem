import crypto from "node:crypto"
import path from "node:path"
import fs from "node:fs"
import { getDb } from "./db"

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

export function getEventSummaries(): EventSummaryDto[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT event_id,
           COALESCE(NULLIF(MAX(event_name), ''), event_id) as event_name,
           COALESCE(NULLIF(MAX(template_id), ''), 'default') as template_id,
           COUNT(*) as total_count,
           SUM(CASE WHEN status = 'Issued' THEN 1 ELSE 0 END) as issued_count,
           MIN(created_at) as earliest_created_at
    FROM certificates
    GROUP BY event_id
    ORDER BY MIN(created_at) DESC
  `).all() as Array<{
    event_id: string
    event_name: string
    template_id: string
    total_count: number
    issued_count: number
    earliest_created_at: string | null
  }>

  return rows.map((r) => ({
    eventId: r.event_id,
    eventName: r.event_name,
    templateId: r.template_id || "default",
    earliestCreatedAt: r.earliest_created_at ?? null,
    issuedCount: Number(r.issued_count || 0),
    totalCount: Number(r.total_count || 0),
  }))
}

export function getEventDetail(
  eventId: string,
  page: number = 1,
  pageSize: number = 50
): {
  eventId: string
  eventName: string
  templateId: string
  totalCount: number
  issuedCount: number
  earliestCreatedAt: string | null
  certificates: CertificateSummaryDto[]
} | null {
  const db = getDb()
  const summaryRow = db.prepare(`
    SELECT event_id,
           event_name,
           template_id,
           COUNT(*) as total_count,
           SUM(CASE WHEN status = 'Issued' THEN 1 ELSE 0 END) as issued_count,
           MIN(created_at) as earliest_created_at
    FROM certificates
    WHERE lower(event_id) = lower(?)
    GROUP BY event_id, event_name, template_id
    LIMIT 1
  `).get(eventId) as {
    event_id: string
    event_name: string
    template_id: string
    total_count: number
    issued_count: number
    earliest_created_at: string | null
  } | undefined

  if (!summaryRow) return null

  const p = Math.max(1, page)
  const ps = Math.min(200, Math.max(1, pageSize))
  const offset = (p - 1) * ps

  const certRows = db.prepare(`
    SELECT * FROM certificates
    WHERE lower(event_id) = lower(?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(eventId, ps, offset) as unknown as CertificateRow[]

  return {
    eventId: summaryRow.event_id,
    eventName: summaryRow.event_name,
    templateId: summaryRow.template_id || "default",
    totalCount: Number(summaryRow.total_count || 0),
    issuedCount: Number(summaryRow.issued_count || 0),
    earliestCreatedAt: summaryRow.earliest_created_at,
    certificates: certRows.map(toSummaryDto),
  }
}

export function getCertificatesPaginated(params: {
  page?: number
  pageSize?: number
  eventId?: string | null
  status?: string | null
  search?: string | null
}): PaginatedResult<CertificateSummaryDto> {
  const db = getDb()
  const page = Math.max(1, params.page || 1)
  const pageSize = Math.min(200, Math.max(1, params.pageSize || 50))
  const offset = (page - 1) * pageSize

  const conditions: string[] = []
  const values: any[] = []

  if (params.eventId && params.eventId.trim().length > 0) {
    conditions.push("lower(event_id) = lower(?)")
    values.push(params.eventId.trim())
  }

  if (params.status && params.status.trim().length > 0) {
    conditions.push("lower(status) = lower(?)")
    values.push(params.status.trim())
  }

  if (params.search && params.search.trim().length > 0) {
    const s = `%${params.search.trim()}%`
    conditions.push(`(
      participant_name LIKE ? OR
      certificate_number LIKE ? OR
      public_id LIKE ? OR
      event_name LIKE ? OR
      participant_email LIKE ?
    )`)
    values.push(s, s, s, s, s)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM certificates ${whereClause}`).get(...values) as { cnt: number }
  const totalCount = Number(countRow?.cnt || 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const query = `
    SELECT * FROM certificates
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `
  const rows = db.prepare(query).all(...values, pageSize, offset) as unknown as CertificateRow[]

  return {
    items: rows.map(toSummaryDto),
    totalCount,
    page,
    pageSize,
    totalPages,
  }
}

export function getCertificateByPublicId(publicId: string): CertificateSummaryDto | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM certificates WHERE lower(public_id) = lower(?) LIMIT 1").get(publicId.trim()) as unknown as CertificateRow | undefined
  return row ? toSummaryDto(row) : null
}

export function getCertificateRecordByPublicId(publicId: string): CertificateRow | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM certificates WHERE lower(public_id) = lower(?) LIMIT 1").get(publicId.trim()) as unknown as CertificateRow | undefined
  return row ?? null
}

export function getCertificatePdfPath(publicId: string): string | null {
  const row = getCertificateRecordByPublicId(publicId)
  if (!row || !row.artifact_path) return null
  const fullPath = path.resolve(process.cwd(), "data", row.artifact_path)
  return fs.existsSync(fullPath) ? fullPath : null
}

function prefix(s: string): string {
  return `${Buffer.byteLength(s, "utf8")}:${s}`
}

export function appendAuditEvent(eventType: string, entityId: string, payload: Record<string, string | null>): void {
  const db = getDb()
  const head = db.prepare("SELECT sequence, event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1").get() as { sequence: number; event_hash: string } | undefined

  const sequence = (head?.sequence || 0) + 1
  const previousHash = head?.event_hash || "GENESIS"
  const now = new Date()
  // Format C# UtcDateTime 'O' string: e.g. 2026-10-02T07:30:35.7863617Z (or millisecond standard ISO)
  const occurredAt = now.toISOString()

  // Canonical payload with sorted keys
  const sortedKeys = Object.keys(payload).sort()
  const sortedObj: Record<string, string | null> = {}
  for (const k of sortedKeys) {
    sortedObj[k] = payload[k]
  }
  const canonicalPayload = JSON.stringify(sortedObj)

  const canonical = [
    "audit-v1",
    sequence.toString(),
    previousHash,
    occurredAt,
    prefix(eventType),
    prefix(entityId),
    prefix(canonicalPayload),
  ].join("\n")

  const eventHash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex").toUpperCase()

  db.prepare(`
    INSERT INTO audit_events (sequence, previous_hash, event_hash, occurred_at, event_type, entity_id, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sequence, previousHash, eventHash, occurredAt, eventType, entityId, canonicalPayload)
}

export function revokeCertificate(publicId: string, reason: string): boolean {
  const db = getDb()
  const cert = getCertificateRecordByPublicId(publicId)
  if (!cert) return false
  if (cert.status === "Revoked") return true

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE certificates
    SET status = 'Revoked',
        revoked_at = ?,
        revocation_reason = ?
    WHERE id = ?
  `).run(now, reason.trim(), cert.id)

  appendAuditEvent("certificate.revoked", cert.public_id, {
    reason: reason.trim(),
  })

  return true
}
