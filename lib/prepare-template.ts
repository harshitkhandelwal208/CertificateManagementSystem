import { PDFDocument } from "pdf-lib"

/** Convert supported certificate backgrounds to a single-page PDF. */
export async function prepareTemplate(bytes: Uint8Array, fileName: string): Promise<Uint8Array> {
  bytes = Uint8Array.from(bytes)
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error("File must be between 1 byte and 10MB.")
  const name = fileName.toLowerCase()
  const isPdf = name.endsWith(".pdf") && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
  const isPng = name.endsWith(".png") && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
  const isJpeg = /\.(jpg|jpeg)$/.test(name) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (!isPdf && !isPng && !isJpeg) throw new Error("Upload a valid PDF, PNG, JPG, or JPEG file.")
  if (isPdf) {
    const pdf = await PDFDocument.load(bytes)
    if (!pdf.getPageCount()) throw new Error("The PDF must contain at least one page.")
    return bytes
  }
  const pdf = await PDFDocument.create()
  const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const page = pdf.addPage([image.width, image.height])
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height })
  return pdf.save()
}
