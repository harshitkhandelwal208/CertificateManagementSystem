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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CsvDropzone, type ParsedRecipient } from "@/components/issue/csv-dropzone"
import { ManualRecipients } from "@/components/issue/manual-recipients"
import { GoogleSheetsPanel } from "@/components/issue/google-sheets-panel"
import { credentialTemplates } from "@/lib/templates"

interface Recipient {
  name: string
  email?: string
}

function IssueContent() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const customTemplateKey = searchParams.get("custom") === "1" ? searchParams.get("customKey") : null
  const customTemplateId = customTemplateKey
    ? `custom-${customTemplateKey.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")}`
    : null
  const defaultTemplate = customTemplateId ?? searchParams.get("template") ?? credentialTemplates[0].id
  const [templateId, setTemplateId] = useState(defaultTemplate)
  const [eventCustomTemplate, setEventCustomTemplate] = useState<string | null>(null)
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
        if (data?.templateId) {
          setTemplateId((prev) => (prev === credentialTemplates[0].id ? data.templateId : prev))
          if (typeof data.templateId === "string" && data.templateId.startsWith("custom-")) {
            setEventCustomTemplate(data.templateId)
          }
        }
      })
      .catch(() => {})
  }, [params.id])

  const activeRecipientCount = mode === "manual" ? manualRecipients.filter((r) => r.name.trim()).length : csvRecipients.length
  const canSubmit = consent && !submitting && (
    (mode === "manual" && recipientsValid && manualRecipients.length > 0) ||
    (mode === "csv" && csvRecipients.length > 0)
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    try {
      let recipients: Recipient[] = []

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
        toast.success("Batch Issuance Complete", {
          description: `Successfully issued ${succeeded} of ${recipients.length} certificates.`,
        })
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
          <FieldLabel htmlFor="credential-template">Certificate Design Template</FieldLabel>
          <Select value={templateId} onValueChange={(v) => setTemplateId(String(v))}>
            <SelectTrigger id="credential-template" className="mt-2 w-full sm:w-80">
              <SelectValue placeholder="Select template" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {customTemplateId && (
                  <SelectItem value={customTemplateId}>Uploaded PDF template</SelectItem>
                )}
                {eventCustomTemplate && eventCustomTemplate !== customTemplateId && (
                  <SelectItem value={eventCustomTemplate}>Assigned PDF template ({eventCustomTemplate})</SelectItem>
                )}
                {credentialTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: template.accent }}
                    />
                    {template.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>



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
