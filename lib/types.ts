// ── Backend DTOs ──────────────────────────────────────────────────────

export interface EventSummary {
  eventId: string;
  eventName: string;
  templateId: string;
  earliestCreatedAt: string | null;
  issuedCount: number;
  totalCount: number;
}

export interface CertificateSummary {
  publicId: string;
  certificateNumber: string;
  participantName: string;
  participantEmail: string | null;
  eventId: string;
  eventName: string;
  templateId: string;
  status: 'Pending' | 'Issued' | 'Revoked' | 'Failed';
  createdAt: string;
  issuedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface EventDetail {
  eventId: string;
  eventName: string;
  templateId: string;
  earliestCreatedAt: string | null;
  issuedCount: number;
  totalCount: number;
  certificates: CertificateSummary[];
}

// Verification response from CertificateVerification.Web
export interface VerificationResult {
  publicId: string;
  status: string;
  certificateNumber: string;
  participantName: string;
  eventName: string;
  templateId?: string;
  issuedAtUtc: string | null;
  revokedAtUtc: string | null;
  revocationReason: string | null;
  signatureValid: boolean;
  fileSha256: string | null;
}

// ── Auth DTOs ─────────────────────────────────────────────────────────

export interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserInfo;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

// ── Issue DTOs ────────────────────────────────────────────────────────

export interface DemoIssueRequest {
  fullName: string;
  eventName?: string;
}

export interface DemoIssueResponse {
  publicId: string;
  certificateNumber: string;
  verifyPath: string;
}

export interface RevokeRequest {
  reason: string;
}

// ── Audit ─────────────────────────────────────────────────────────────

export interface AuditVerificationResult {
  isValid: boolean;
  eventCount: number;
  headHash: string | null;
  error: string | null;
}
