import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import {
  ArrowLeft,
  CalendarDays,
  Award,
  ShieldCheck,
  ShieldX,
  CheckCircle2,
  FileCheck2,
  Hash,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/logo"
import { Footer } from "@/components/footer"
import { TamperProofCertificateViewer } from "@/components/verify/tamper-proof-certificate-viewer"
import { CredentialActions } from "@/components/credential/credential-actions"
import { EvervaultCard, Icon } from "@/components/ui/evervault-card"
import { DitherShader } from "@/components/ui/dither-shader"
import { formatDate } from "@/lib/format"
import { resolveTemplate } from "@/lib/templates"
import { getVerificationUrl } from "@/lib/api"
import { getCertificateByPublicId } from "@/lib/server/certificates"
import type { VerificationResult } from "@/lib/types"

async function fetchVerification(publicId: string): Promise<VerificationResult | null> {
  // 1. Try independent verification service on port 5001
  try {
    const res = await fetch(`${getVerificationUrl()}/api/verify/${encodeURIComponent(publicId)}`, {
      cache: "no-store",
    })
    if (res.ok) {
      return (await res.json()) as VerificationResult
    }
  } catch {
    // Verification service unreachable, fall back to internal DB lookup
  }

  // 2. Direct database fallback
  try {
    const cert = getCertificateByPublicId(publicId)
    if (!cert) return null
    return {
      publicId: cert.publicId,
      certificateNumber: cert.certificateNumber,
      participantName: cert.participantName,
      eventName: cert.eventName,
      status: cert.status,
      issuedAtUtc: cert.issuedAtUtc ?? null,
      revokedAtUtc: cert.revokedAtUtc ?? null,
      revocationReason: cert.revocationReason ?? null,
      signatureValid: cert.status === "Issued",
      fileSha256: cert.artifactSha256 ?? null,
    }
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const cert = getCertificateByPublicId(id)
  return {
    title: cert
      ? `${cert.participantName} — Clinically Evolve Verified Credential`
      : "Verify Credential — Clinically Evolve",
    description: cert
      ? `Official cryptographic verification for ${cert.participantName}'s credential issued by Clinically Evolve.`
      : "Official cryptographic verification portal for Clinically Evolve credentials.",
    icons: {
      icon: [
        { url: "/icon.png", type: "image/png" },
        { url: "/favicon.ico" },
        { url: "/logo.png", type: "image/png" },
      ],
      apple: "/logo.png",
      shortcut: "/favicon.ico",
    },
  }
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const verification = await fetchVerification(id)
  if (!verification) notFound()

  const certificateRecord = getCertificateByPublicId(id)
  const templateId = verification.templateId || certificateRecord?.templateId || "heritage-rust"
  const isCustomTemplate = templateId.toLowerCase().startsWith("custom-")
  const template = resolveTemplate(templateId)
  const accent = template.accent
  const isRevoked = verification.status === "Revoked"
  const isValid = verification.status === "Valid" || (!isRevoked && verification.signatureValid)

  return (
    <div className="print-portal relative min-h-screen overflow-hidden bg-neutral-950 text-white dark">
      {/* Animated DitherShader Background */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-30">
        <DitherShader
          src="/images/dither-bg.jpg"
          gridSize={3}
          ditherMode="bayer"
          colorMode="grayscale"
          primaryColor="#000000"
          secondaryColor="#ffffff"
          invert={false}
          animated={true}
          animationSpeed={0.012}
          threshold={0.5}
          className="h-full w-full"
        />
      </div>

      {/* Ambient accent light pool */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(60% 50% at 50% 0%, ${accent}1f 0%, transparent 70%), radial-gradient(40% 35% at 85% 90%, ${accent}14 0%, transparent 70%)`,
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-noise opacity-60 mix-blend-overlay" />

      {/* Header */}
      <header className="print-hide relative z-10 border-b border-border/70">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Logo />
          <Link
            href="/verify"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Verify another
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto max-w-5xl px-6 py-12">
        <div className="rise mb-10 text-center">
          {isRevoked ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3.5 py-1 text-xs font-medium text-destructive">
              <ShieldX className="size-4" />
              Certificate Revoked
            </span>
          ) : isValid ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3.5 py-1 text-xs font-medium text-success">
              <ShieldCheck className="size-4" />
              Cryptographically Verified Credential
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3.5 py-1 text-xs font-medium text-warning">
              <FileCheck2 className="size-4" />
              Authenticity Status: {verification.status}
            </span>
          )}

          <h1 className="mt-4 font-serif text-3xl font-semibold text-balance text-foreground sm:text-4xl">
            {isRevoked
              ? `This certificate has been revoked.`
              : `Congratulations, ${verification.participantName.split(" ")[0]}.`}
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {isRevoked
              ? `Revocation Reason: ${verification.revocationReason || "Revoked by issuing authority"}`
              : "This official credential was cryptographically signed and independently verified against the offline Root Certificate Authority."}
          </p>
        </div>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_280px]">
          {/* Static certificate document */}
          <div className="print-sheet relative mx-auto w-full max-w-3xl rise rise-1">
            <TamperProofCertificateViewer
              pdfUrl={`/api/certificates/${encodeURIComponent(verification.publicId)}/download`}
              publicId={verification.publicId}
              certificateNumber={verification.certificateNumber}
              participantName={verification.participantName}
              eventName={verification.eventName}
              issueDate={verification.issuedAtUtc ? formatDate(verification.issuedAtUtc) : "—"}
              template={template}
              isCustomTemplate={isCustomTemplate}
            />
            <p className="print-hide mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" />
              {verification.issuedAtUtc ? `Issued ${formatDate(verification.issuedAtUtc)}` : "Pending"} · #{verification.certificateNumber}
            </p>
          </div>

          {/* Actions & Cryptographic Proof */}
          <aside className="print-hide rise rise-2 flex flex-col gap-4 lg:sticky lg:top-24">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              {isRevoked ? (
                <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs font-semibold text-destructive shadow-sm">
                  <ShieldX className="size-3.5 text-destructive shrink-0" />
                  <span>Certificate Revoked</span>
                </div>
              ) : (
                <div className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs font-semibold tracking-wide text-emerald-400 shadow-sm">
                  <ShieldCheck className="size-3.5 text-emerald-400 shrink-0" />
                  <span>Verified Credential</span>
                </div>
              )}
              <div className="mt-4 flex flex-col gap-2.5">
                <CredentialActions
                  publicId={verification.publicId}
                  participantName={verification.participantName}
                  eventName={verification.eventName}
                  issuedAt={verification.issuedAtUtc}
                />
              </div>
            </div>

            {/* Cryptographic Verification Card */}
            <div className="relative flex flex-col items-start rounded-xl border border-border bg-card p-4 shadow-sm h-[20rem] overflow-hidden group">
              <Icon className="absolute h-6 w-6 -top-3 -left-3 text-muted-foreground" />
              <Icon className="absolute h-6 w-6 -bottom-3 -left-3 text-muted-foreground" />
              <Icon className="absolute h-6 w-6 -top-3 -right-3 text-muted-foreground" />
              <Icon className="absolute h-6 w-6 -bottom-3 -right-3 text-muted-foreground" />

              <EvervaultCard text={isRevoked ? "REVOKED" : isValid ? "VERIFIED" : "AUDITED"} />

              <h2 className="mt-4 text-sm font-medium text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-primary" />
                Cryptographic Proof
              </h2>
              <p className="mt-2 text-xs leading-snug text-muted-foreground">
                {isRevoked
                  ? "Status: Revoked in public registry. Any attempted verification will flag this credential."
                  : isValid
                  ? "CMS digital signature verified against offline Root CA. Tamper-evident SHA-256 artifact intact."
                  : "Tamper-proof and verified. Hover over the card to inspect the real-time cryptographic cipher."}
              </p>
              {verification.fileSha256 && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground font-mono truncate max-w-full">
                  <Hash className="size-3 shrink-0" />
                  <span className="truncate">{verification.fileSha256}</span>
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="print-hide mt-14 flex flex-col items-center gap-2 text-center">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Issued with care by</p>
          <div className="flex items-center gap-2">
            <Logo />
          </div>
        </div>
      </main>

      {/* Footer */}
      <div className="print-hide relative z-10">
        <Footer />
      </div>
    </div>
  )
}
