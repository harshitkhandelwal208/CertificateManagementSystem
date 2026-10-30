"use client"

interface TamperProofCertificateViewerProps {
  pdfUrl: string
  participantName: string
}

export function TamperProofCertificateViewer({ pdfUrl, participantName }: TamperProofCertificateViewerProps) {
  return (
    <div className="w-full">
      <iframe
        src={pdfUrl}
        title={`Issued certificate for ${participantName}`}
        className="h-[70vh] min-h-[32rem] w-full rounded-xl border border-border/70 bg-card"
      />
      <p className="mt-2 text-center text-xs text-muted-foreground">
        If the document does not appear, <a href={pdfUrl} className="underline">open the issued PDF</a>.
      </p>
    </div>
  )
}
