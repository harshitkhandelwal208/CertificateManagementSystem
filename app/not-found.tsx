import Link from "next/link"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background flex flex-col">
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-6 sm:px-10">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex items-center gap-2">
            <Button variant="ghost" render={<Link href="/login">Log in</Link>} />
          </nav>
        </header>

        <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase backdrop-blur-sm">
            404 Error
          </span>

          <h1 className="mt-6 font-serif text-4xl font-bold leading-[1.1] text-foreground sm:text-6xl">
            Page not found
          </h1>

          <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Sorry, we couldn’t find the page you’re looking for. It might have been moved or doesn’t exist.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Button size="lg" className="h-11 px-6 text-base" render={<Link href="/" />}>
              Go back home
            </Button>
          </div>
        </section>
      </div>
    </main>
  )
}
