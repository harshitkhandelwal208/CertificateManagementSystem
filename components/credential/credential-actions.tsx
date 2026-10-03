"use client"

import { useState, useEffect } from "react"
import { Check, Copy, Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LinkedinIcon } from "@/components/linkedin-icon"

interface CredentialActionsProps {
  publicId: string
  participantName: string
  eventName: string
  issuedAt: string | null
}

async function downloadCertificate(publicId: string) {
  try {
    const res = await fetch(`/api/certificates/${encodeURIComponent(publicId)}/download`)
    if (!res.ok) {
      // Fallback to print dialog
      toast.info("Print dialog opened", {
        description: 'Choose "Save as PDF" as the destination to download your certificate.',
      })
      window.print()
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `certificate-${publicId.slice(0, 8)}.pdf`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success("Certificate downloaded")
  } catch {
    // Fallback to print dialog
    toast.info("Print dialog opened", {
      description: 'Choose "Save as PDF" as the destination to download your certificate.',
    })
    window.print()
  }
}

export function CredentialActions({
  publicId,
  participantName,
  eventName,
  issuedAt,
}: CredentialActionsProps) {
  const [copied, setCopied] = useState(false)
  const [verifyUrl, setVerifyUrl] = useState("")

  useEffect(() => {
    setVerifyUrl(`${window.location.origin}/verify/${publicId}`)
  }, [publicId])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(verifyUrl)
      setCopied(true)
      toast.success("Verification link copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy the link", { description: "Copy it from your browser's address bar." })
    }
  }

  const issueDate = issuedAt ? new Date(issuedAt) : new Date()
  const linkedInUrl =
    "https://www.linkedin.com/profile/edit/?trk=certificate_add_url" +
    `&name=${encodeURIComponent(eventName)}` +
    `&organizationName=${encodeURIComponent("Credentia")}` +
    `&issueYear=${issueDate.getFullYear()}` +
    `&issueMonth=${issueDate.getMonth() + 1}` +
    (verifyUrl ? `&certUrl=${encodeURIComponent(verifyUrl)}` : "")

  return (
    <>
      <Button
        className="w-full justify-start h-10 px-3.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm shadow-sm transition-all"
        onClick={() => downloadCertificate(publicId)}
      >
        <Download data-icon="inline-start" className="size-4 text-white" />
        Download certificate
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start h-10 px-3.5 border-border/80 bg-neutral-900/60 hover:bg-neutral-800 text-neutral-100 hover:text-white font-medium text-sm transition-all"
        render={<a href={linkedInUrl} target="_blank" rel="noopener noreferrer" />}
      >
        <LinkedinIcon className="size-4 text-[#0a66c2]" data-icon="inline-start" />
        Add to LinkedIn profile
      </Button>
      <Button
        variant="outline"
        className="w-full justify-start h-10 px-3.5 border-border/80 bg-neutral-900/60 hover:bg-neutral-800 text-neutral-100 hover:text-white font-medium text-sm transition-all"
        onClick={copyLink}
      >
        {copied ? (
          <Check data-icon="inline-start" className="size-4 text-emerald-400" />
        ) : (
          <Copy data-icon="inline-start" className="size-4 text-neutral-400" />
        )}
        <span className={copied ? "text-emerald-400 font-medium" : ""}>
          {copied ? "Link Copied" : "Copy verification link"}
        </span>
      </Button>
    </>
  )
}
