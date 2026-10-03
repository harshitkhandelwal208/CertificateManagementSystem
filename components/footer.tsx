import Link from "next/link"
import { ShieldCheck, ExternalLink } from "lucide-react"

export function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-border/60 bg-card/30 py-6 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Clinically Evolve" className="size-4 object-contain rounded-xs bg-white/10" />
          <span>Clinically Evolve &bull; Credential Operations Platform &bull; &copy; {currentYear}</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href={process.env.NEXT_PUBLIC_VERIFICATION_URL || "http://localhost:5001"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            Public Verification Portal
            <ExternalLink className="size-3" />
          </a>
          <span>&bull;</span>
          <span>Offline Root CA Secured</span>
        </div>
      </div>
    </footer>
  )
}
