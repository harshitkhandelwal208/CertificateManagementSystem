import { NextResponse } from "next/server"
import { writeRuntimeFile } from "@/lib/server/files"
import { apiError, stringField } from "@/lib/server/http"

import { normalizeTemplateId } from "@/lib/template-layout"
import { prepareTemplate } from "@/lib/prepare-template"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const key = formData.get("templateKey")

    if (!(file instanceof File) || typeof key !== "string") {
      return NextResponse.json({ error: "A PDF, PNG, JPG, or JPEG file and template key are required." }, { status: 400 })
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be between 1 byte and 10MB." }, { status: 400 })
    }

    let bytes: Uint8Array
    try { bytes = await prepareTemplate(new Uint8Array(await file.arrayBuffer()), file.name) }
    catch { return NextResponse.json({ error: "Upload a valid PDF, PNG, JPG, or JPEG file." }, { status: 400 }) }

    const templateId = normalizeTemplateId(stringField(key, 'template key', 180))
    await writeRuntimeFile(`templates/${templateId}.pdf`, bytes)

    return NextResponse.json({ templateId, fileName: file.name })
  } catch (error) {
    return apiError(error)
  }
}
