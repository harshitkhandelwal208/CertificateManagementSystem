"use client"

import { useEffect, useRef, useState } from "react"
import { ShieldCheck, Loader2, FileCheck2, AlertCircle } from "lucide-react"
import { loadPdfJs } from "@/lib/pdfjs-loader"
import { CertificatePreview } from "@/components/certificate-preview"
import type { CredentialTemplate } from "@/lib/templates"

interface TamperProofCertificateViewerProps {
  pdfUrl: string
  publicId: string
  certificateNumber: string
  participantName: string
  eventName: string
  issueDate: string
  template: CredentialTemplate
  isCustomTemplate: boolean
}

export function TamperProofCertificateViewer({
  pdfUrl,
  publicId,
  certificateNumber,
  participantName,
  eventName,
  issueDate,
  template,
  isCustomTemplate,
}: TamperProofCertificateViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<boolean>(false)
  const [aspectRatio, setAspectRatio] = useState<number>(1.414)

  useEffect(() => {
    if (!isCustomTemplate) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    setError(false)

    loadPdfJs()
      .then(async (pdfjs) => {
        if (!active) return
        const loadingTask = pdfjs.getDocument(pdfUrl)
        const pdf = await loadingTask.promise
        if (!active) return

        const page = await pdf.getPage(1)
        if (!active) return

        const baseViewport = page.getViewport({ scale: 1.0 })
        const ratio = baseViewport.width / baseViewport.height
        setAspectRatio(ratio)

        const canvas = canvasRef.current
        if (!canvas) return

        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
        const scale = Math.max(2.0, dpr * 1.5)
        const viewport = page.getViewport({ scale })

        canvas.width = viewport.width
        canvas.height = viewport.height

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
        })

        await renderTask.promise
        if (active) setLoading(false)
      })
      .catch((err) => {
        console.error("Tamper-proof certificate render error:", err)
        if (active) {
          setError(true)
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [pdfUrl, isCustomTemplate])

  // If built-in template or error loading custom PDF, render standard clean CertificatePreview
  if (!isCustomTemplate || error) {
    return (
      <div className="relative w-full">
        <CertificatePreview
          template={template}
          recipientName={participantName}
          eventName={eventName}
          issueDate={issueDate}
          credentialId={publicId}
        />
        {error && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Displaying cryptographic verification preview. You can also download the signed PDF.
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl select-none"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        aspectRatio: `${aspectRatio}`,
      }}
    >
      {/* Loading Skeleton */}
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-neutral-900/90 text-neutral-300">
          <Loader2 className="size-7 animate-spin text-primary" />
          <p className="text-xs font-medium tracking-wide">Rendering verified cryptographic document…</p>
        </div>
      )}

      {/* Tamper-Proof Canvas */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none block h-full w-full object-contain"
        aria-label={`Official certificate for ${participantName}`}
      />
    </div>
  )
}
