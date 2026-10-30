import Link from "next/link"
import { Plus, Users, CheckCircle2, FolderKanban } from "lucide-react"
import { AppShell } from "@/components/dashboard/app-shell"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty"
import { formatDate } from "@/lib/format"
import { resolveTemplate } from "@/lib/templates"
import type { EventSummary } from "@/lib/types"
import { getEventSummaries } from "@/lib/server/certificates"

async function fetchEvents(): Promise<EventSummary[]> {
  try {
    return getEventSummaries()
  } catch {
    return []
  }
}


export default async function EventsPage() {
  const events = await fetchEvents()
  const hasEvents = events.length > 0

  return (
    <AppShell
      action={
        <Button render={<Link href="/events/new" />}>
          <Plus data-icon="inline-start" />
          New event
        </Button>
      }
    >
      <div className="mb-8 flex flex-col gap-1.5">
        <h1 className="font-serif text-3xl font-semibold text-foreground">Events</h1>
        <p className="text-sm text-muted-foreground">
          Create an event, upload a certificate template, and issue verifiable credentials to your recipients.
        </p>
      </div>

      {hasEvents ? (
        <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const template = resolveTemplate(event.templateId)
            const progress = event.totalCount > 0 ? Math.round((event.issuedCount / event.totalCount) * 100) : 0
            return (
              <Link
                key={event.eventId}
                href={`/events/${event.eventId}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  className="grow-x absolute inset-x-0 top-0 h-1.5"
                  style={{ backgroundColor: template.accent }}
                />
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-balance font-serif text-lg font-semibold text-foreground">{event.eventName}</h3>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: template.accentSoft, color: template.accent }}
                  >
                    {template.name}
                  </span>
                </div>

                <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="size-4" />
                  <span>
                    {event.issuedCount} / {event.totalCount} issued
                  </span>
                </div>
                <Progress value={progress} className="mt-2 h-1.5" />

                <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3 text-xs text-muted-foreground">
                  <span>
                    Created {event.earliestCreatedAt ? formatDate(event.earliestCreatedAt) : "—"}
                  </span>
                  {progress === 100 ? (
                    <span className="flex items-center gap-1 font-medium text-success">
                      <CheckCircle2 className="size-3.5" />
                      Complete
                    </span>
                  ) : (
                    <span className="font-medium text-primary">In progress</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderKanban />
            </EmptyMedia>
            <EmptyTitle>No events yet</EmptyTitle>
            <EmptyDescription>Create your first event to start issuing verifiable credentials.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/events/new" />}>
              <Plus data-icon="inline-start" />
              New event
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </AppShell>
  )
}
