"use client"

import Link from "next/link"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, QrCode, ShieldCheck, PenLine } from "lucide-react"
import { AppShell } from "@/components/dashboard/app-shell"
import { Stepper } from "@/components/dashboard/stepper"
import { Button } from "@/components/ui/button"
import { CertificatePreview } from "@/components/certificate-preview"
import { CustomPdfPreview, useCustomPdfTemplate } from "@/components/template/custom-pdf-preview"
import { credentialTemplates } from "@/lib/templates"
import { loadDraft } from "@/app/events/new/page"

function PreviewContent() {
  const searchParams = useSearchParams()
  const templateId = searchParams.get("template") ?? credentialTemplates[0].id
  const showCustomPreview = searchParams.get("custom") === "1"
  const template = credentialTemplates.find((t) => t.id === templateId) ?? credentialTemplates[0]
  const customTemplate = useCustomPdfTemplate("new-event")
  const draft = loadDraft()
  const eventName = draft?.name ?? "Your Event Name"
  const eventSlug = eventName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `event-${Date.now()}`

  return (
    <AppShell>
      <Link
        href={`/events/new/template?template=${templateId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to template
      </Link>

      <div className="mb-8 flex flex-col gap-1.5">
        <Stepper steps={["Event details", "Design", "Confirm"]} current={3} />
        <h1 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">Confirm your sample</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Here&apos;s a preview of what recipients will receive, complete with a scannable QR code and
          verified signatures. Continue when you&apos;re happy with the design.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(0,300px)]">
        <div className="mx-auto w-full max-w-xl">
          {showCustomPreview && customTemplate.pdfUrl ? (
            <CustomPdfPreview storageKey="new-event" className="rise" sampleName="Sample Recipient" sampleEvent={eventName} />
          ) : (
            <CertificatePreview
              className="rise"
              template={template}
              recipientName="Sample Recipient"
              eventName={eventName}
              issueDate={new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              credentialId="SAMPLE-CERT-2026"
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <QrCode className="size-4 text-primary" />
              QR verification
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Every certificate includes a unique QR code linking to a public, tamper-proof verification page.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <PenLine className="size-4 text-primary" />
              Digital signatures
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Signatures render exactly as configured for this design, giving credentials an authentic,
              signed-off look.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className="size-4 text-success" />
              Instant validation
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Anyone can verify authenticity in one click — no account or login required.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-end gap-3 border-t border-border/70 pt-6">
        <Button variant="outline" render={<Link href={`/events/new/template`} />}>
          Back
        </Button>
        <Button render={<Link href={`/events/${eventSlug}/issue?template=${templateId}&custom=${showCustomPreview ? "1" : "0"}&customKey=new-event&name=${encodeURIComponent(eventName)}`} />}>
          Looks good, continue
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </AppShell>
  )
}

export default function PreviewPage() {
  return (
    <Suspense>
      <PreviewContent />
    </Suspense>
  )
}
