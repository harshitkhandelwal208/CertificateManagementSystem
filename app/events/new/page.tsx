"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react"
import { AppShell } from "@/components/dashboard/app-shell"
import { Stepper } from "@/components/dashboard/stepper"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { loadDraft, saveDraft } from "@/lib/event-draft"

export default function NewEventPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  useEffect(() => {
    const draft = loadDraft()
    if (draft) {
      setName(draft.name)
      setDescription(draft.description)
    }
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    saveDraft({ name: name.trim(), description: description.trim() })
    router.push("/events/new/template")
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

      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex flex-col items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-5" />
          </div>
          <Stepper steps={["Event details", "Design", "Confirm"]} current={1} />
          <h1 className="font-serif text-2xl font-semibold text-foreground">Create a new event</h1>
          <p className="text-sm text-muted-foreground">
            Give your event a name. You&apos;ll upload a certificate template and add recipients next.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="event-name">Event name</FieldLabel>
              <Input
                id="event-name"
                placeholder="e.g. 2026 Volunteer Training"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
              <FieldDescription>This appears on the certificate and in your events list.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="event-description">Description (optional)</FieldLabel>
              <Textarea
                id="event-description"
                placeholder="A short description of what this credential recognizes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
          </FieldGroup>

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" render={<Link href="/events" />}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Continue
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
