"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  FileText,
  Loader2,
  RotateCcw,
  Move,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Type,
  Palette,
  Check,
  Sparkles,
  ArrowUp,
  ArrowDown,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { getCustomTemplate, saveCustomTemplate } from "@/lib/custom-template"
import {
  AVAILABLE_FONTS,
  COLOR_PRESETS,
  DEFAULT_TEMPLATE_LAYOUT,
  LAYOUT_PRESETS,
  type TemplateLayoutConfig,
} from "@/lib/template-layout"
import { cn } from "@/lib/utils"
import { loadPdfJs } from "@/lib/pdfjs-loader"

interface CustomPdfPreviewProps {
  storageKey: string
  className?: string
  sampleName?: string
  sampleEvent?: string
  allowCustomization?: boolean
  onLayoutChange?: (layout: TemplateLayoutConfig) => void
}

async function uploadTemplateToServer(storageKey: string, file: Blob, fileName: string) {
  const formData = new FormData()
  formData.append("file", file, fileName)
  formData.append("templateKey", storageKey)
  const response = await fetch("/api/templates/upload", { method: "POST", body: formData })
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error || "Could not upload PDF template")
  }
}

export function useCustomPdfTemplate(storageKey: string) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let objectUrl: string | null = null
    let active = true

    setLoading(true)
    getCustomTemplate(storageKey)
      .then((template) => {
        if (!active || !template) return
        objectUrl = URL.createObjectURL(template.blob)
        setPdfUrl(objectUrl)
        setFileName(template.name)
        void uploadTemplateToServer(storageKey, template.blob, template.name).catch(() => {})
      })
      .catch(() => {
        if (active) setPdfUrl(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [storageKey])

  async function saveFile(file: File) {
    await uploadTemplateToServer(storageKey, file, file.name)
    await saveCustomTemplate(storageKey, file)
    setPdfUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl)
      return URL.createObjectURL(file)
    })
    setFileName(file.name)
  }

  return { pdfUrl, fileName, loading, saveFile }
}

export function CustomPdfPreview({
  storageKey,
  className,
  sampleName = "Alpha Briito",
  sampleEvent,
  allowCustomization = true,
  onLayoutChange,
}: CustomPdfPreviewProps) {
  const { pdfUrl, fileName, loading } = useCustomPdfTemplate(storageKey)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [layout, setLayout] = useState<TemplateLayoutConfig>(DEFAULT_TEMPLATE_LAYOUT)
  const [isDragging, setIsDragging] = useState(false)
  const [savedStatus, setSavedStatus] = useState<"saved" | "saving" | null>(null)
  const [showColorMenu, setShowColorMenu] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<number>(1.414)
  const [renderingCanvas, setRenderingCanvas] = useState<boolean>(true)
  const [containerWidth, setContainerWidth] = useState<number>(842)

  // Track container width for true-to-scale font sizing
  useEffect(() => {
    if (!containerRef.current) return
    const updateWidth = () => {
      if (containerRef.current && containerRef.current.clientWidth > 0) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }
    updateWidth()
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width)
        }
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Render PDF directly to HTML5 Canvas (guarantees 100% 1:1 pixel coordinates without viewer toolbars)
  useEffect(() => {
    if (!pdfUrl) return
    let active = true
    setRenderingCanvas(true)

    loadPdfJs()
      .then(async (pdfjs) => {
        const loadingTask = pdfjs.getDocument(pdfUrl)
        const pdf = await loadingTask.promise
        if (!active) return
        const page = await pdf.getPage(1)
        if (!active) return

        const baseViewport = page.getViewport({ scale: 1 })
        const pageRatio = baseViewport.width / baseViewport.height
        setAspectRatio(pageRatio)

        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
        const scale = Math.max(2, dpr * 1.5)
        const viewport = page.getViewport({ scale })

        canvas.width = viewport.width
        canvas.height = viewport.height

        const ctx = canvas.getContext("2d")
        if (!ctx) return
        const renderTask = page.render({ canvasContext: ctx, viewport })
        await renderTask.promise
        if (active) setRenderingCanvas(false)
      })
      .catch((err) => {
        console.error("PDF canvas preview error:", err)
        if (active) setRenderingCanvas(false)
      })

    return () => {
      active = false
    }
  }, [pdfUrl])

  // Fetch initial layout from server
  useEffect(() => {
    let active = true
    fetch(`/api/templates/layout?templateKey=${encodeURIComponent(storageKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TemplateLayoutConfig | null) => {
        if (active && data) {
          setLayout(data)
          onLayoutChange?.(data)
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [storageKey, onLayoutChange])

  // Save layout to server
  const saveLayoutToServer = useCallback(
    async (updated: TemplateLayoutConfig) => {
      setSavedStatus("saving")
      try {
        await fetch("/api/templates/layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateKey: storageKey,
            layout: updated,
          }),
        })
        setSavedStatus("saved")
        setTimeout(() => setSavedStatus(null), 2500)
      } catch {
        setSavedStatus(null)
      }
    },
    [storageKey]
  )

  // Debounced auto-save
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const updateLayout = useCallback(
    (updater: (prev: TemplateLayoutConfig) => TemplateLayoutConfig) => {
      setLayout((prev) => {
        const next = updater(prev)
        onLayoutChange?.(next)
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = setTimeout(() => {
          void saveLayoutToServer(next)
        }, 350)
        return next
      })
    },
    [saveLayoutToServer, onLayoutChange]
  )

  // Pointer drag calculation
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!allowCustomization || !containerRef.current) return
    e.preventDefault()
    setIsDragging(true)

    const rect = containerRef.current.getBoundingClientRect()
    const calcCoords = (clientX: number, clientY: number) => {
      const xPx = clientX - rect.left
      const yPx = clientY - rect.top

      const xPercent = Math.max(2, Math.min(98, (xPx / rect.width) * 100))
      const yPercent = Math.max(2, Math.min(98, (yPx / rect.height) * 100))

      return {
        xPercent: Math.round(xPercent * 10) / 10,
        yPercent: Math.round(yPercent * 10) / 10,
      }
    }

    // If clicking directly onto canvas away from text box, immediately reposition to clicked spot!
    const target = e.target as HTMLElement
    const clickedOnElement = target.closest(".group\\/element")
    if (!clickedOnElement) {
      const initial = calcCoords(e.clientX, e.clientY)
      updateLayout((prev) => ({ ...prev, ...initial }))
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const next = calcCoords(moveEvent.clientX, moveEvent.clientY)
      updateLayout((prev) => ({
        ...prev,
        ...next,
      }))
    }

    const handlePointerUp = () => {
      setIsDragging(false)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  // Nudge positioning by 0.5%
  const nudge = (dx: number, dy: number) => {
    updateLayout((prev) => ({
      ...prev,
      xPercent: Math.max(2, Math.min(98, Math.round((prev.xPercent + dx) * 10) / 10)),
      yPercent: Math.max(2, Math.min(98, Math.round((prev.yPercent + dy) * 10) / 10)),
    }))
  }

  if (loading) {
    return (
      <div className="flex aspect-[7/5] items-center justify-center rounded-xl border border-border bg-muted/30">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading PDF preview" />
      </div>
    )
  }

  if (!pdfUrl) {
    return (
      <div className="flex aspect-[7/5] flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <RotateCcw className="size-6 text-destructive" />
        <p className="text-sm font-medium text-foreground">This PDF preview is unavailable.</p>
        <p className="text-xs text-muted-foreground">Upload the template again to continue.</p>
      </div>
    )
  }

  const transformStyle =
    layout.textAlign === "left"
      ? "translate(0, -50%)"
      : layout.textAlign === "right"
      ? "translate(-100%, -50%)"
      : "translate(-50%, -50%)"

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Canva-Style Design Toolbar */}
      {allowCustomization && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Font Family Selector */}
            <div className="flex items-center gap-1 text-xs">
              <Type className="size-3.5 text-muted-foreground ml-1" />
              <select
                aria-label="Font Family"
                value={layout.fontFamily}
                onChange={(e) => updateLayout((prev) => ({ ...prev, fontFamily: e.target.value }))}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground outline-none hover:bg-muted focus:ring-2 focus:ring-ring"
              >
                {AVAILABLE_FONTS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Font Size Stepper */}
            <div className="flex items-center rounded-lg border border-border bg-background">
              <button
                type="button"
                onClick={() => updateLayout((prev) => ({ ...prev, fontSize: Math.max(14, prev.fontSize - 2) }))}
                className="flex size-8 items-center justify-center text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Decrease font size"
              >
                -
              </button>
              <span className="w-11 text-center text-xs font-mono font-medium text-foreground">
                {layout.fontSize}pt
              </span>
              <button
                type="button"
                onClick={() => updateLayout((prev) => ({ ...prev, fontSize: Math.min(72, prev.fontSize + 2) }))}
                className="flex size-8 items-center justify-center text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Increase font size"
              >
                +
              </button>
            </div>

            {/* Bold Toggle */}
            <button
              type="button"
              onClick={() =>
                updateLayout((prev) => ({
                  ...prev,
                  fontWeight: prev.fontWeight === "bold" ? "normal" : "bold",
                }))
              }
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border text-xs transition-colors",
                layout.fontWeight === "bold"
                  ? "border-primary bg-primary/10 text-primary font-bold"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
              title="Toggle Bold"
            >
              <Bold className="size-3.5" />
            </button>

            {/* Text Alignment */}
            <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => updateLayout((prev) => ({ ...prev, textAlign: "left" }))}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-xs transition-colors",
                  layout.textAlign === "left"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title="Align Left (Award line)"
              >
                <AlignLeft className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateLayout((prev) => ({ ...prev, textAlign: "center" }))}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-xs transition-colors",
                  layout.textAlign === "center"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title="Align Center"
              >
                <AlignCenter className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateLayout((prev) => ({ ...prev, textAlign: "right" }))}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-xs transition-colors",
                  layout.textAlign === "right"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title="Align Right"
              >
                <AlignRight className="size-3.5" />
              </button>
            </div>

            {/* Color Swatches */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColorMenu(!showColorMenu)}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted"
                title="Text Color"
              >
                <span className="size-3.5 rounded-full border border-black/20" style={{ backgroundColor: layout.color }} />
                <Palette className="size-3 text-muted-foreground" />
              </button>

              {showColorMenu && (
                <div className="absolute left-0 top-full z-30 mt-1 flex flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-xl backdrop-blur-md">
                  <p className="text-[11px] font-medium text-muted-foreground">Select text color:</p>
                  <div className="flex items-center gap-1.5">
                    {COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.hex}
                        type="button"
                        onClick={() => {
                          updateLayout((prev) => ({ ...prev, color: preset.hex }))
                          setShowColorMenu(false)
                        }}
                        className={cn(
                          "size-6 rounded-full border border-black/20 transition-transform hover:scale-110",
                          layout.color === preset.hex && "ring-2 ring-primary ring-offset-1"
                        )}
                        style={{ backgroundColor: preset.hex }}
                        title={preset.name}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2 text-xs">
                    <span className="text-muted-foreground">Custom:</span>
                    <input
                      type="color"
                      value={layout.color}
                      onChange={(e) => updateLayout((prev) => ({ ...prev, color: e.target.value }))}
                      className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Presets & Nudge Controls */}
          <div className="flex items-center gap-2">
            {/* Presets dropdown */}
            <div className="flex items-center gap-1">
              <Sparkles className="size-3.5 text-primary" />
              <select
                aria-label="Position Presets"
                onChange={(e) => {
                  const preset = LAYOUT_PRESETS.find((p) => p.name === e.target.value)
                  if (preset) {
                    updateLayout((prev) => ({ ...prev, ...preset.layout }))
                  }
                }}
                defaultValue=""
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
              >
                <option value="" disabled>
                  Presets…
                </option>
                {LAYOUT_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Micro Nudge arrows */}
            <div className="hidden sm:flex items-center rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => nudge(-0.8, 0)}
                className="p-1.5 text-muted-foreground hover:text-foreground"
                title="Nudge Left"
              >
                <ArrowLeftIcon className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => nudge(0, -0.8)}
                className="p-1.5 text-muted-foreground hover:text-foreground"
                title="Nudge Up"
              >
                <ArrowUp className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => nudge(0, 0.8)}
                className="p-1.5 text-muted-foreground hover:text-foreground"
                title="Nudge Down"
              >
                <ArrowDown className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => nudge(0.8, 0)}
                className="p-1.5 text-muted-foreground hover:text-foreground"
                title="Nudge Right"
              >
                <ArrowRightIcon className="size-3" />
              </button>
            </div>

            {/* Saved indicator */}
            {savedStatus === "saving" && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Saving…
              </span>
            )}
            {savedStatus === "saved" && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-success">
                <Check className="size-3" /> Saved
              </span>
            )}
          </div>
        </div>
      )}

      {/* Interactive Certificate Canvas Stage */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        style={{ aspectRatio }}
        className={cn(
          "group/stage relative w-full overflow-hidden rounded-xl border border-border/70 bg-card shadow-lg select-none",
          allowCustomization && "cursor-crosshair"
        )}
      >
        {/* Native HTML5 Canvas rendered directly from PDF (zero browser toolbar, 1:1 pixel coords) */}
        <canvas
          ref={canvasRef}
          className="pointer-events-none block size-full"
          aria-label={`${fileName ?? "Custom PDF"} background`}
        />

        {/* Loading overlay while rendering PDF to canvas */}
        {renderingCanvas && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/85 backdrop-blur-xs">
            <Loader2 className="size-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground font-medium">Loading certificate preview…</span>
          </div>
        )}

        {/* Dynamic Drag Crosshairs (Active while dragging) */}
        {isDragging && (
          <>
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-primary/60"
              style={{ top: `${layout.yPercent}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 border-l border-dashed border-primary/60"
              style={{ left: `${layout.xPercent}%` }}
            />
          </>
        )}

        {/* Interactive Recipient Name Element */}
        <div
          className={cn(
            "group/element absolute transition-all duration-75",
            isDragging ? "cursor-grabbing opacity-90 scale-[1.02]" : "cursor-grab hover:scale-[1.01]"
          )}
          style={{
            left: `${layout.xPercent}%`,
            top: `${layout.yPercent}%`,
            transform: transformStyle,
          }}
        >
          <div
            className={cn(
              "relative rounded px-3 py-1 transition-all",
              allowCustomization &&
                "border-2 border-dashed border-transparent hover:border-primary/50 group-hover/element:bg-primary/5 group-hover/element:border-primary/60",
              isDragging && "border-primary bg-primary/10 shadow-lg"
            )}
          >
            {/* Visual Drag Handle & Coords Tooltip */}
            {allowCustomization && (
              <div className="absolute -top-7 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-neutral-900/90 px-2 py-0.5 text-[10px] font-mono text-white opacity-0 shadow-md backdrop-blur transition-opacity group-hover/element:opacity-100 group-hover/stage:opacity-100">
                <Move className="size-2.5" />
                <span>
                  X: {layout.xPercent}% · Y: {layout.yPercent}%
                </span>
              </div>
            )}

            {/* Rendered Recipient Text */}
            <p
              style={{
                fontFamily: layout.fontFamily,
                fontSize: `${Math.max(12, Math.round(layout.fontSize * Math.max(0.35, containerWidth / 842)))}px`,
                fontWeight: layout.fontWeight === "bold" ? 700 : 400,
                color: layout.color,
                textAlign: layout.textAlign,
                lineHeight: 1.15,
                textShadow: "0 1px 2px rgba(255,255,255,0.7)",
              }}
              className="whitespace-nowrap select-none tracking-tight"
            >
              {sampleName}
            </p>

            {sampleEvent && (
              <p
                style={{
                  fontFamily: layout.fontFamily,
                  textAlign: layout.textAlign,
                }}
                className="mt-0.5 text-xs font-medium text-slate-800/80 drop-shadow-sm"
              >
                {sampleEvent}
              </p>
            )}
          </div>
        </div>

        {/* Informative helper pill at bottom */}
        {allowCustomization && (
          <div className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-background/85 px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            💡 Click and drag the recipient name to position it anywhere on your certificate
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span className="truncate">{fileName}</span>
        <span className="font-mono text-[11px]">
          Target: {layout.fontFamily} · {layout.fontSize}pt · {layout.textAlign} · {layout.xPercent}%,{" "}
          {layout.yPercent}%
        </span>
      </div>
    </div>
  )
}