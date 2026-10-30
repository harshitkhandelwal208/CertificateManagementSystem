/**
 * Session helpers — bridge between the new JWT auth system (lib/auth.ts)
 * and components that still read the lightweight user shape.
 */

export type AppUser = {
  name: string
  email: string
}

const SESSION_KEY = "credentia:user"

export function readStoredUser(): AppUser | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as AppUser) : null
  } catch {
    return null
  }
}

/**
 * Write or clear user data.
 * Prefer `writeAuth()` from `lib/auth.ts` for login/register flows —
 * it calls this internally to keep everything in sync.
 */
export function writeStoredUser(user: AppUser | null) {
  if (typeof window === "undefined") return

  if (!user) {
    window.localStorage.removeItem(SESSION_KEY)
    return
  }

  window.localStorage.setItem(SESSION_KEY, JSON.stringify(user))
}

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "CU"
}
