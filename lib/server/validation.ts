import { DEFAULT_TEMPLATE_LAYOUT, AVAILABLE_FONTS, type TemplateLayoutConfig } from '@/lib/template-layout'
import { ApiError } from './http'
export function validateLayout(layout: unknown): TemplateLayoutConfig {
  if (!layout || typeof layout !== 'object') throw new ApiError('A valid layout is required.')
  const candidate = { ...DEFAULT_TEMPLATE_LAYOUT, ...layout } as TemplateLayoutConfig
  for (const [key, min, max] of [['xPercent',0,100],['yPercent',0,100],['fontSize',12,80]] as const) {
    if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key]) || candidate[key] < min || candidate[key] > max) throw new ApiError(`Invalid ${key}.`)
  }
  if (!AVAILABLE_FONTS.some(font => font.id === candidate.fontFamily) || !['normal','bold'].includes(candidate.fontWeight) || !/^#[0-9a-fA-F]{6}$/.test(candidate.color) || !['left','center','right'].includes(candidate.textAlign)) throw new ApiError('Invalid font, color, or text alignment.')
  return { xPercent: candidate.xPercent, yPercent: candidate.yPercent, fontSize: candidate.fontSize, fontFamily: candidate.fontFamily, fontWeight: candidate.fontWeight, color: candidate.color, textAlign: candidate.textAlign }
}
