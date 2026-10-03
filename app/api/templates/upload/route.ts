import { NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"

import { normalizeTemplateId } from "@/lib/template-layout"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file")
    const key = formData.get("templateKey")

    if (!(file instanceof File) || typeof key !== "string") {
      return NextResponse.json({ error: "A PDF file and template key are required." }, { status: 400 })
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "PDF must be between 1 byte and 10MB." }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.subarray(0, 4).toString("ascii") !== "%PDF") {
      return NextResponse.json({ error: "The uploaded file is not a valid PDF." }, { status: 400 })
    }

    const templateId = normalizeTemplateId(key)
    const templatesDirectory = path.resolve(process.cwd(), "data", "templates")
    await fs.mkdir(templatesDirectory, { recursive: true })
    await fs.writeFile(path.join(templatesDirectory, `${templateId}.pdf`), bytes)

    return NextResponse.json({ templateId, fileName: file.name })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save PDF template." }, { status: 500 })
  }
}