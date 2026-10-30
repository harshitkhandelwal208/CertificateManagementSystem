export interface EventDraft {
  name: string
  description: string
}

const DRAFT_KEY = "credentia:event-draft"

export function loadDraft(): EventDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY)
    return raw ? (JSON.parse(raw) as EventDraft) : null
  } catch {
    return null
  }
}

export function saveDraft(draft: EventDraft) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}
