export interface TemplateLayoutConfig {
  xPercent: number // 0 to 100
  yPercent: number // 0 to 100
  fontSize: number // in points, e.g. 18 to 64
  fontFamily: string // "Noto Sans" | "Times New Roman" | "Georgia" | "Arial" | "Playfair Display" | "Cinzel"
  fontWeight: "normal" | "bold"
  color: string // hex code e.g. #000000
  textAlign: "left" | "center" | "right"
}

export const DEFAULT_TEMPLATE_LAYOUT: TemplateLayoutConfig = {
  xPercent: 50,
  yPercent: 40,
  fontSize: 28,
  fontFamily: "Noto Sans",
  fontWeight: "bold",
  color: "#000000",
  textAlign: "center",
}

export const AVAILABLE_FONTS = [
  { id: "Noto Sans", name: "Noto Sans (Modern)", style: "sans-serif" },
  { id: "Times New Roman", name: "Times New Roman (Academic)", style: "serif" },
  { id: "Georgia", name: "Georgia (Classic Serif)", style: "serif" },
  { id: "Arial", name: "Arial (Clean Sans)", style: "sans-serif" },
  { id: "Courier New", name: "Courier New (Monospace)", style: "monospace" },
]

export const COLOR_PRESETS = [
  { name: "Pure Black", hex: "#000000" },
  { name: "Navy Blue", hex: "#1e3a8a" },
  { name: "Dark Slate", hex: "#1e293b" },
  { name: "Royal Blue", hex: "#2563eb" },
  { name: "Burgundy", hex: "#831843" },
  { name: "Dark Gold", hex: "#92400e" },
]

export const LAYOUT_PRESETS: Array<{ name: string; layout: Partial<TemplateLayoutConfig> }> = [
  {
    name: "Award Blank Space (Left)",
    layout: { xPercent: 10, yPercent: 44, textAlign: "left", fontSize: 32 },
  },
  {
    name: "Award Blank Space (Centered)",
    layout: { xPercent: 50, yPercent: 44, textAlign: "center", fontSize: 32 },
  },
  {
    name: "Left Aligned (Award Line)",
    layout: { xPercent: 18, yPercent: 41, textAlign: "left", fontSize: 26 },
  },
  {
    name: "Centered (Standard)",
    layout: { xPercent: 50, yPercent: 40, textAlign: "center", fontSize: 28 },
  },
  {
    name: "Lower Center",
    layout: { xPercent: 50, yPercent: 50, textAlign: "center", fontSize: 30 },
  },
]

export function normalizeTemplateId(key: string): string {
  const normalized = key.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!normalized) return "custom-default"
  return normalized.startsWith("custom-") ? normalized : `custom-${normalized}`
}
