"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, Upload } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/dashboard/app-shell"
import { Stepper } from "@/components/dashboard/stepper"
import { Button } from "@/components/ui/button"
import { CertificatePreview } from "@/components/certificate-preview"
import { CertStage } from "@/components/credential/cert-stage"
import { PdfUploadZone } from "@/components/template/pdf-upload-zone"
import { CustomPdfPreview, useCustomPdfTemplate } from "@/components/template/custom-pdf-preview"
import { credentialTemplates } from "@/lib/templates"
import { cn } from "@/lib/utils"

export default function SelectTemplatePage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const [selected, setSelected] = useState(credentialTemplates[0].id)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showCustomPreview, setShowCustomPreview] = useState(false)
  const customTemplate = useCustomPdfTemplate(`event:${params.id}`)

  const activeTemplate = credentialTemplates.find((t) => t.id === selected) ?? credentialTemplates[0]

  const handlePdfUpload = async (file: File) => {
    setUploading(true)
    try {
      await customTemplate.saveFile(file)
      setShowCustomPreview(true)
      toast.success("PDF Template Ready", {
        description: `${file.name} will be used for the preview and issued certificates.`,
      })
      setShowUploadModal(false)
    } catch (error) {
      toast.error("Upload Failed", {
        description: "Could not upload PDF template. Please try again.",
      })
    } finally {
      setUploading(false)
    }
  }

  return (
    <AppShell>
      <Link
        href="/events"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to events
      </Link>

      <div className="mb-8 flex flex-col gap-1.5">
        <Stepper steps={["Event details", "Design", "Confirm"]} current={2} />
        <h1 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">
          Choose a design template
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Select the default certificate design for this event. You can preview it with sample data before
          issuing credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="flex flex-col gap-3">
          {credentialTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => {
                setSelected(template.id)
                setShowCustomPreview(false)
              }}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4 text-left transition-all",
                selected === template.id
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
                style={{ backgroundColor: template.accentSoft, color: template.accent }}
              >
                {template.name.charAt(0)}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium text-foreground">{template.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{template.description}</span>
              </span>
              {selected === template.id && (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" />
                </span>
              )}
            </button>
          ))}

          {/* Upload Custom Template Button */}
          <button
            type="button"
            onClick={() => setShowUploadModal(!showUploadModal)}
            className={cn(
              "flex items-center gap-3 rounded-xl border-2 border-dashed p-4 text-left transition-all",
              showUploadModal
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/30 hover:border-primary/40"
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Upload className="size-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-foreground">Upload Custom PDF</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Use your own certificate template</span>
            </span>
          </button>

          {/* Upload Zone */}
          {showUploadModal && (
            <div className="rounded-xl border border-border bg-card p-4">
              <PdfUploadZone onFileAccepted={handlePdfUpload} disabled={uploading} />
              <p className="mt-3 text-xs text-muted-foreground">
                Sample recipient data will appear in the confirmation preview and on issued certificates.
              </p>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Live preview</p>
          <CertStage>
            {showCustomPreview && customTemplate.pdfUrl ? (
              <CustomPdfPreview storageKey={`event:${params.id}`} className="rise" />
            ) : (
              <CertificatePreview
                key={activeTemplate.id}
                className="rise"
                template={activeTemplate}
                recipientName="Jordan Ellery"
                eventName="Your Event Name"
                issueDate="Sep 20th, 2026"
                credentialId="preview-mode"
              />
            )}
          </CertStage>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-end gap-3 border-t border-border/70 pt-6">
        <Button variant="outline" render={<Link href="/events" />}>
          Cancel
        </Button>
        <Button render={<Link href={`/events/${params.id}/preview?template=${selected}&custom=${showCustomPreview ? "1" : "0"}`} />}>
          Continue
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </AppShell>
  )
}
