"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { 
  ArrowLeft, 
  Send, 
  Download, 
  ExternalLink, 
  ShieldCheck, 
  ShieldX, 
  Users, 
  RefreshCw, 
  AlertTriangle, 
  X, 
  Loader2 
} from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/dashboard/app-shell"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { CountUp } from "@/components/dashboard/count-up"
import { resolveTemplate } from "@/lib/templates"
import { formatDate } from "@/lib/format"
import type { EventDetail, CertificateSummary } from "@/lib/types"

const statusStyles: Record<string, string> = {
  Issued: "bg-success/10 text-success border-success/20",
  Pending: "bg-warning/15 text-warning border-warning/20",
  Revoked: "bg-destructive/10 text-destructive border-destructive/20",
  Failed: "bg-destructive/10 text-destructive border-destructive/20",
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPolling, setIsPolling] = useState(false)

  // Revocation state
  const [revokingCert, setRevokingCert] = useState<CertificateSummary | null>(null)
  const [revocationReason, setRevocationReason] = useState("")
  const [isSubmittingRevocation, setIsSubmittingRevocation] = useState(false)

  const verificationBase = process.env.NEXT_PUBLIC_VERIFICATION_URL || "http://localhost:5001"

  async function loadDetail() {
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}`)
      if (res.status === 404) {
        notFound()
      }
      if (!res.ok) throw new Error("Could not load event")
      const data = await res.json()
      setDetail(data)
    } catch (err: any) {
      toast.error("Failed to load event details", { description: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDetail()
  }, [id])

  async function handlePollNow() {
    setIsPolling(true)
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(id)}/poll`, { method: "POST" })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || "Event has no active Google Sheets configuration to poll.")
      }
      toast.success("Poll triggered", { description: "Checked linked Google Form responses for new entries." })
      await loadDetail()
    } catch (err: any) {
      toast.info("Sheets Polling Info", {
        description: err.message || "Configure Google Sheets credentials in appsettings.json to enable auto-sync.",
      })
    } finally {
      setIsPolling(false)
    }
  }

  async function handleConfirmRevocation() {
    if (!revokingCert) return
    if (!revocationReason.trim()) {
      toast.error("Reason required", { description: "Please provide a reason for certificate revocation." })
      return
    }

    setIsSubmittingRevocation(true)
    try {
      const res = await fetch(`/api/certificates/${revokingCert.publicId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: revocationReason.trim() }),
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || "Revocation request failed")
      }

      toast.success("Certificate Revoked", {
        description: `Certificate for ${revokingCert.participantName} has been revoked.`,
      })

      // Update local state
      if (detail) {
        setDetail({
          ...detail,
          certificates: detail.certificates.map((c) =>
            c.publicId === revokingCert.publicId
              ? { ...c, status: "Revoked", revokedAt: new Date().toISOString(), revocationReason: revocationReason.trim() }
              : c
          ),
        })
      }

      setRevokingCert(null)
      setRevocationReason("")
    } catch (err: any) {
      toast.error("Revocation failed", { description: err.message })
    } finally {
      setIsSubmittingRevocation(false)
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    )
  }

  if (!detail) {
    return (
      <AppShell>
        <div className="p-8 text-center text-muted-foreground">Event not found.</div>
      </AppShell>
    )
  }

  const template = resolveTemplate(detail.templateId)
  const credentialList = detail.certificates || []
  const progress = detail.totalCount > 0 ? Math.round((detail.issuedCount / detail.totalCount) * 100) : 0

  return (
    <AppShell
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePollNow}
            disabled={isPolling}
            title="Poll linked Google Sheet responses"
          >
            <RefreshCw className={`size-3.5 ${isPolling ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Sync Responses</span>
          </Button>
          <Button render={<Link href={`/events/${detail.eventId}/issue?template=${encodeURIComponent(detail.templateId)}&custom=${detail.templateId?.startsWith("custom-") ? "1" : "0"}&customKey=${encodeURIComponent(detail.templateId)}&name=${encodeURIComponent(detail.eventName)}`} />}>
            <Send data-icon="inline-start" />
            Issue Credentials
          </Button>
        </div>
      }
    >
      <Link
        href="/events"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to events
      </Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">{detail.eventName}</h1>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium border"
              style={{ 
                backgroundColor: template.accentSoft, 
                color: template.accent,
                borderColor: `${template.accent}40`
              }}
            >
              {template.name}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Event ID: <span className="font-mono">{detail.eventId}</span></p>
        </div>
        <div className="flex min-w-48 flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              <CountUp value={detail.issuedCount} /> / {detail.totalCount} issued
            </span>
            <span className="font-medium text-foreground">
              <CountUp value={progress} />%
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Cohort Credentials ({credentialList.length})</h2>
      </div>

      {credentialList.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Certificate #</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentialList.map((cert: CertificateSummary) => (
                <TableRow key={cert.publicId}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[11px] font-medium">
                          {getInitials(cert.participantName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground">{cert.participantName}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{cert.participantEmail ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{cert.certificateNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {cert.issuedAt ? formatDate(cert.issuedAt) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusStyles[cert.status] ?? ""} variant="secondary">
                      {cert.status === "Issued" && <ShieldCheck className="size-3" data-icon="inline-start" />}
                      {cert.status === "Revoked" && <ShieldX className="size-3" data-icon="inline-start" />}
                      {cert.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Download PDF */}
                      <a
                        href={`/api/certificates/${cert.publicId}/download`}
                        download
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Download cryptographically signed PDF"
                      >
                        <Download className="size-3.5" />
                        <span className="hidden sm:inline">PDF</span>
                      </a>

                      {/* Verify on independent portal */}
                      <a
                        href={`${verificationBase}/verify/${cert.publicId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Open verification in independent portal"
                      >
                        <ExternalLink className="size-3.5" />
                        <span className="hidden sm:inline">Verify</span>
                      </a>

                      {/* Revoke */}
                      {cert.status !== "Revoked" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRevokingCert(cert)
                            setRevocationReason("")
                          }}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive/80 transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Revoke certificate"
                        >
                          <ShieldX className="size-3.5" />
                          <span className="hidden sm:inline">Revoke</span>
                        </button>
                      ) : (
                        <span
                          className="text-[11px] italic text-muted-foreground"
                          title={cert.revocationReason || "Revoked"}
                        >
                          Revoked
                        </span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Send />
            </EmptyMedia>
            <EmptyTitle>No credentials issued yet</EmptyTitle>
            <EmptyDescription>Issue your first batch of credentials for this event using manual entry or CSV upload.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href={`/events/${detail.eventId}/issue?template=${encodeURIComponent(detail.templateId)}&custom=${detail.templateId?.startsWith("custom-") ? "1" : "0"}&customKey=${encodeURIComponent(detail.templateId)}&name=${encodeURIComponent(detail.eventName)}`} />}>
              <Send data-icon="inline-start" />
              Issue credentials
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {/* Revocation Confirmation Dialog */}
      {revokingCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" />
              </div>
              <button
                type="button"
                onClick={() => setRevokingCert(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <h3 className="mt-4 font-serif text-xl font-semibold text-foreground">
              Revoke Certificate?
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              You are revoking the credential for <strong className="text-foreground">{revokingCert.participantName}</strong> ({revokingCert.certificateNumber}). The public verification portal will immediately flag this certificate as revoked.
            </p>

            <div className="mt-4">
              <label htmlFor="modal-revocation-reason" className="block text-xs font-medium text-foreground mb-1.5">
                Revocation Reason (Required for audit trail)
              </label>
              <textarea
                id="modal-revocation-reason"
                rows={3}
                placeholder="e.g. Issued in error, failed requirements, or student requested replacement"
                value={revocationReason}
                onChange={(e) => setRevocationReason(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={() => setRevokingCert(null)} disabled={isSubmittingRevocation}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmRevocation}
                disabled={isSubmittingRevocation || !revocationReason.trim()}
              >
                {isSubmittingRevocation ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Revoking…
                  </>
                ) : (
                  "Confirm Revocation"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
