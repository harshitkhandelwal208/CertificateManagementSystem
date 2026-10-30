"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/dashboard/app-shell"
import { Stepper } from "@/components/dashboard/stepper"
import { Button } from "@/components/ui/button"
import { PdfUploadZone } from "@/components/template/pdf-upload-zone"
import { CustomPdfPreview, useCustomPdfTemplate } from "@/components/template/custom-pdf-preview"
import { loadDraft } from "@/lib/event-draft"

export default function NewEventTemplatePage() {
  const router = useRouter()
  const [draftChecked, setDraftChecked] = useState(false)
  const [uploading, setUploading] = useState(false)
  const customTemplate = useCustomPdfTemplate("new-event")

  useEffect(() => {
    if (!loadDraft()?.name) {
      toast.error("No event in progress", { description: "Start by naming your event." })
      router.replace("/events/new")
      return
    }
    setDraftChecked(true)
  }, [router])

  async function handlePdfUpload(file: File) {
    setUploading(true)
    try {
      await customTemplate.saveFile(file)
      toast.success("Template ready", { description: `${file.name} will be used for issued certificates.` })
    } catch (error) {
      toast.error("Upload failed", { description: "Could not upload the template. Please try again." })
      throw error
    } finally {
      setUploading(false)
    }
  }

  return (
    <AppShell>
      <Link href="/events/new" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to event details
      </Link>
      {draftChecked && (
        <>
          <div className="mb-8 flex flex-col gap-1.5">
            <Stepper steps={["Event details", "Upload template", "Confirm"]} current={2} />
            <h1 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">Upload a certificate template</h1>
            <p className="max-w-xl text-sm text-muted-foreground">Upload the certificate design to use for this event. You can preview it before issuing credentials.</p>
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="rounded-xl border border-border bg-card p-4">
              <PdfUploadZone onFileAccepted={handlePdfUpload} disabled={uploading} />
              {customTemplate.fileName && <p className="mt-3 break-all text-xs text-muted-foreground">Selected: {customTemplate.fileName}</p>}
            </div>
            <div className="lg:sticky lg:top-24 lg:self-start">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Live preview</p>
              {customTemplate.pdfUrl ? (
                <CustomPdfPreview storageKey="new-event" className="rise" />
              ) : (
                <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  Upload a PDF, PNG, JPG, or JPEG to see your certificate preview.
                </div>
              )}
            </div>
          </div>
          <div className="mt-10 flex items-center justify-end gap-3 border-t border-border/70 pt-6">
            <Button variant="outline" render={<Link href="/events/new" />}>Cancel</Button>
            {customTemplate.pdfUrl && !uploading ? (
              <Button render={<Link href="/events/new/preview" />}>Continue <ArrowRight data-icon="inline-end" /></Button>
            ) : (
              <Button disabled>Continue <ArrowRight data-icon="inline-end" /></Button>
            )}
          </div>
        </>
      )}
    </AppShell>
  )
}
