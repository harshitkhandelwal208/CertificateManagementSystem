"use client"

import Link from "next/link"
import { Suspense, useState, useEffect } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Send, Sheet, FileSpreadsheet, UserPlus } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/dashboard/app-shell"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel } from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CsvDropzone, type ParsedRecipient } from "@/components/issue/csv-dropzone"
import { ManualRecipients } from "@/components/issue/manual-recipients"
import { GoogleSheetsPanel } from "@/components/issue/google-sheets-panel"
import { AVAILABLE_FONTS, normalizeTemplateId, type TemplateLayoutConfig } from "@/lib/template-layout"

interface Recipient {
  name: string
  email?: string
}

function IssueContent() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const customTemplateKey = searchParams.get("custom") === "1" ? searchParams.get("customKey") : null
  const queryTemplate = searchParams.get("template")
  const customTemplateId = queryTemplate?.startsWith("custom-") ? queryTemplate : customTemplateKey ? normalizeTemplateId(customTemplateKey) : null
  const [templateId, setTemplateId] = useState(customTemplateId ?? "")
  const [layout, setLayout] = useState<TemplateLayoutConfig | null>(null)
  const [timesUnavailable, setTimesUnavailable] = useState(false)
  const [consent, setConsent] = useState(false)
  const [recipientsValid, setRecipientsValid] = useState(false)
  const [manualRecipients, setManualRecipients] = useState<Recipient[]>([])
  const [csvRecipients, setCsvRecipients] = useState<ParsedRecipient[]>([])
  const [mode, setMode] = useState("manual")
  const [submitting, setSubmitting] = useState(false)
  const queryEventName = searchParams.get("name")
  const [eventName, setEventName] = useState(() => queryEventName || params.id)

  useEffect(() => {
    // Try to get real event name and assigned template from API
    fetch(`/api/events/${encodeURIComponent(params.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.eventName) setEventName(data.eventName)
        if (typeof data?.templateId === "string" && data.templateId.startsWith("custom-")) {
          setTemplateId((prev) => prev || data.templateId)
        }
      })
      .catch(() => {})
  }, [params.id])

  useEffect(() => {
    if (!templateId) return
    let active = true
    fetch(`/api/templates/layout?templateKey=${encodeURIComponent(templateId)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((saved: TemplateLayoutConfig | null) => {
        if (!active) return
        try {
          const cached = customTemplateKey && localStorage.getItem(`certificate-layout:${customTemplateKey}`)
          if (cached) saved = JSON.parse(cached) as TemplateLayoutConfig
        } catch {}
        setLayout(saved)
      })
      .catch(() => { if (active) setLayout(null) })
    return () => { active = false }
  }, [templateId, customTemplateKey])

  useEffect(() => {
    if (layout?.fontFamily !== "Times New Roman") { setTimesUnavailable(false); return }
    let active = true
    fetch(`/api/templates/times-font?weight=${layout.fontWeight === "bold" ? "bold" : "regular"}`)
      .then((res) => { if (active) setTimesUnavailable(!res.ok) })
      .catch(() => { if (active) setTimesUnavailable(true) })
    return () => { active = false }
  }, [layout?.fontFamily, layout?.fontWeight])

  const activeRecipientCount = mode === "manual" ? manualRecipients.filter((r) => r.name.trim()).length : csvRecipients.length
  const canSubmit = templateId.startsWith("custom-") && Boolean(layout) && consent && !submitting && (
    (mode === "manual" && recipientsValid && manualRecipients.length > 0) ||
    (mode === "csv" && csvRecipients.length > 0)
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    try {
      let recipients: Recipient[] = []
      if (!layout) throw new Error("The template layout could not be loaded.")
      if (mode === "manual") {
        recipients = manualRecipients.filter((r) => r.name.trim())
      } else if (mode === "csv") {
        recipients = csvRecipients
      }

      if (recipients.length === 0) {
        toast.error("No recipients", { description: "Add or upload at least one recipient before issuing." })
        setSubmitting(false)
        return
      }

      const saveLayout = await fetch("/api/templates/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey: templateId, layout }),
      })
      if (!saveLayout.ok) throw new Error("Could not save the certificate layout.")
      if (customTemplateKey) {
        try { localStorage.setItem(`certificate-layout:${customTemplateKey}`, JSON.stringify(layout)) } catch {}
      }

      if (recipients.length === 1) {
        const res = await fetch("/api/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: recipients[0].name,
            email: recipients[0].email,
            eventId: params.id,
            eventName: eventName,
            templateId,
            layout,
          }),
        })
        if (!res.ok) {
          const raw = await res.text()
          let errStr = `HTTP ${res.status}: ${raw.slice(0, 80)}`
          try {
            errStr = JSON.parse(raw).error || errStr
          } catch {}
          throw new Error(errStr)
        }
        toast.success("Certificate Issued", {
          description: `Cryptographically signed certificate created for ${recipients[0].name}.`,
        })
      } else {
        const res = await fetch("/api/issue/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients,
            eventId: params.id,
            eventName: eventName,
            templateId,
            layout,
          }),
        })
        if (!res.ok) {
          const raw = await res.text()
          let errStr = `HTTP ${res.status}: ${raw.slice(0, 80)}`
          try {
            errStr = JSON.parse(raw).error || errStr
          } catch {}
          throw new Error(errStr)
        }
        const results = await res.json()
        const succeeded = results.filter((r: any) => r.success).length
        const firstError = results.find((r: any) => !r.success)?.error
        if (succeeded === 0) throw new Error(firstError || "No certificates were issued.")
        if (succeeded < recipients.length) {
          toast.warning("Some certificates could not be issued", { description: `Issued ${succeeded} of ${recipients.length}. ${firstError || ""}` })
        } else {
          toast.success("Batch Issuance Complete", { description: `Successfully issued ${succeeded} of ${recipients.length} certificates.` })
        }
      }

      router.push(`/events/${params.id}`)
    } catch (err: any) {
      toast.error("Issuance failed", {
        description: err.message || "Something went wrong. Please check your data.",
      })
      setSubmitting(false)
    }
  }

  return (
    <AppShell>
      <Link
        href={`/events/${params.id}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to event
      </Link>

      <div className="mb-8 flex flex-col gap-1.5">
        <h1 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl">Issue Credentials</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          Issue verified certificates for <strong className="text-foreground">{eventName}</strong>. Enter recipients manually or drop a CSV file with your recipient list.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <Tabs value={mode} onValueChange={(v) => setMode(String(v))}>
            <TabsList>
              <TabsTrigger value="manual">
                <UserPlus data-icon="inline-start" />
                Manual Entry
              </TabsTrigger>
              <TabsTrigger value="csv">
                <FileSpreadsheet data-icon="inline-start" />
                Upload CSV ({csvRecipients.length})
              </TabsTrigger>
              <TabsTrigger value="sheets">
                <Sheet data-icon="inline-start" />
                Google Sheets
              </TabsTrigger>
            </TabsList>
            <TabsContent value="manual" className="mt-5">
              <ManualRecipients
                onChange={(valid, recs) => {
                  setRecipientsValid(valid)
                  setManualRecipients(recs)
                }}
              />
            </TabsContent>
            <TabsContent value="csv" className="mt-5">
              <CsvDropzone
                onFileAccepted={(_file, recs) => setCsvRecipients(recs)}
                onReset={() => setCsvRecipients([])}
              />
            </TabsContent>
            <TabsContent value="sheets" className="mt-5">
              <GoogleSheetsPanel />
            </TabsContent>
          </Tabs>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <FieldLabel>Certificate template</FieldLabel>
          {templateId ? (
            <p className="mt-2 text-sm text-muted-foreground">Your uploaded template will be used for these certificates.</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Upload a certificate template before issuing. <Link className="font-medium text-primary underline" href={`/events/${params.id}/template`}>Upload template</Link></p>
          )}
          {layout && (
            <div className="mt-4">
              <FieldLabel htmlFor="issue-font">Recipient name font</FieldLabel>
              <select id="issue-font" value={layout.fontFamily} onChange={(event) => setLayout({ ...layout, fontFamily: event.target.value })} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm sm:w-80">
                {AVAILABLE_FONTS.map((font) => <option key={font.id} value={font.id}>{font.name}</option>)}
              </select>
              {timesUnavailable && <p className="mt-2 text-sm text-destructive">Times New Roman is not installed on this server. Choose Noto Sans, or install the Times New Roman font files before issuing.</p>}
            </div>
          )}

          <label className="mt-5 flex items-start gap-2.5 text-sm text-foreground cursor-pointer">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(Boolean(v))} className="mt-0.5" />
            <span>I confirm that these recipient records are authentic and authorized for credential issuance.</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-6">
          <Button type="button" variant="outline" render={<Link href={`/events/${params.id}`} />}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 data-icon="inline-start" className="animate-spin" />
                Signing & Issuing…
              </>
            ) : (
              <>
                <Send data-icon="inline-start" />
                Issue {activeRecipientCount > 0 ? `${activeRecipientCount} ` : ""}Credentials
              </>
            )}
          </Button>
        </div>
      </form>
    </AppShell>
  )
}

export default function IssuePage() {
  return (
    <Suspense>
      <IssueContent />
    </Suspense>
  )
}
