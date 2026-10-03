export interface CredentialTemplate {
  id: string
  name: string
  description: string
  accent: string
  accentSoft: string
}

export const credentialTemplates: CredentialTemplate[] = [
  {
    id: 'heritage-rust',
    name: 'Heritage Rust',
    description: 'Ornate double border, ideal for achievement & training certificates.',
    accent: '#a8461f',
    accentSoft: '#f3ddc9',
  },
  {
    id: 'amber-classic',
    name: 'Amber Classic',
    description: 'Warm gold accents with a clean academic layout.',
    accent: '#b8791a',
    accentSoft: '#f7e6bf',
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    description: 'Simple rule lines, no ornamentation — great for workshops.',
    accent: '#5c4632',
    accentSoft: '#ece2d2',
  },
]

export function getTemplate(id: string): CredentialTemplate | undefined {
  return credentialTemplates.find((t) => t.id === id)
}

/** Resolve template from ID, returning a sensible fallback when the ID doesn't match any builtin. */
export function resolveTemplate(id: string): CredentialTemplate {
  return (
    getTemplate(id) ?? {
      id,
      name: id.toLowerCase().startsWith('custom-') ? 'Custom PDF' : 'Default',
      description: id.toLowerCase().startsWith('custom-') ? 'Custom uploaded PDF template' : '',
      accent: id.toLowerCase().startsWith('custom-') ? '#2563eb' : '#5c4632',
      accentSoft: id.toLowerCase().startsWith('custom-') ? '#dbeafe' : '#ece2d2',
    }
  )
}
