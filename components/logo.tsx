import { cn } from "@/lib/utils"

export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5 shadow-sm border border-border/80 transition-transform hover:scale-105",
        className
      )}
    >
      <img
        src="/logo.png"
        alt="Clinically Evolve"
        className="h-full w-full object-contain"
        loading="eager"
      />
    </div>
  )
}

export function Logo({
  className,
  wordmarkClassName,
  showSubtitle = true,
}: {
  className?: string
  wordmarkClassName?: string
  showSubtitle?: boolean
}) {
  return (
    <div className={cn("flex items-center gap-2.5 group", className)}>
      <LogoMark />
      <div className="flex flex-col">
        <span
          className={cn(
            "font-sans text-sm font-bold tracking-tight text-foreground leading-tight group-hover:text-primary transition-colors",
            wordmarkClassName
          )}
        >
          CLINICALLY EVOLVE
        </span>
        {showSubtitle && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mt-0.5">
            Credential Portal
          </span>
        )}
      </div>
    </div>
  )
}
