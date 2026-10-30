export interface CredentialTemplate {
  id: string
  name: string
  description: string
  accent: string
  accentSoft: string
}

/** Metadata for uploaded PDFs and certificates issued with older template IDs. */
export function resolveTemplate(id: string): CredentialTemplate {
  const uploaded = id.toLowerCase().startsWith('custom-')
  return {
    id,
    name: uploaded ? 'Uploaded PDF' : 'Certificate',
    description: uploaded ? 'Uploaded PDF template' : '',
    accent: uploaded ? '#2563eb' : '#5c4632',
    accentSoft: uploaded ? '#dbeafe' : '#ece2d2',
  }
}
