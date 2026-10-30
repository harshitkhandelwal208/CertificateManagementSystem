"use client"

import { useState } from "react"
import { Loader2, Mail, Lock, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group"
import { AuthShell } from "@/components/auth/auth-shell"
import { login } from "@/lib/auth"

export default function LoginPage() {
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const email = String(data.get("email") ?? "").trim()
    const password = String(data.get("password") ?? "")

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6) {
      toast.error("Check your details", {
        description: "Please enter a valid email address and password.",
      })
      return
    }

    setSubmitting(true)
    try {
      const auth = await login(email, password)
      toast.success("Welcome back", {
        description: `Signed in as ${auth.user.name}.`,
      })
      window.location.href = "/events"
    } catch (err: any) {
      toast.error("Login failed", {
        description: err.message || "Invalid credentials. Please check your email and password.",
      })
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="NGO Operations Console"
      description="Authorized staff access for certificate issuance, cohort tracking, and verification management."
      footer={
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/80">
          <ShieldAlert className="size-3.5" />
          <span>Restricted system &bull; All administrative actions are cryptographically signed</span>
        </div>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Staff Email Address</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <Mail data-icon="inline-start" />
              </InputGroupAddon>
              <InputGroupInput
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="admin@credentia.local"
                required
                disabled={submitting}
              />
            </InputGroup>
          </Field>

          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <Lock data-icon="inline-start" />
              </InputGroupAddon>
              <InputGroupInput
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
                disabled={submitting}
              />
            </InputGroup>
          </Field>
        </FieldGroup>

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 data-icon="inline-start" className="animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign In to Operations Console"
          )}
        </Button>
      </form>
    </AuthShell>
  )
}
