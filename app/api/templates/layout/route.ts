import { NextResponse } from "next/server"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import {
  DEFAULT_TEMPLATE_LAYOUT,
  normalizeTemplateId,
  type TemplateLayoutConfig,
} from "@/lib/template-layout"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get("templateKey")
    if (!key) {
      return NextResponse.json({ error: "templateKey is required." }, { status: 400 })
    }

    const templateId = normalizeTemplateId(key)
    const dataDir = process.env.DATA_DIR && fsSync.existsSync(process.env.DATA_DIR)
      ? path.resolve(process.env.DATA_DIR)
      : path.resolve(process.cwd(), "data")
    const templatesDirectory = path.resolve(dataDir, "templates")
    const filePath = path.join(templatesDirectory, `${templateId}.json`)

    const candidatePaths = [
      filePath,
      templateId.startsWith("custom-event-")
        ? path.join(templatesDirectory, `custom-${templateId.slice("custom-event-".length)}.json`)
        : null,
      path.join(templatesDirectory, "custom-new-event.json"),
    ].filter(Boolean) as string[]

    for (const candidate of candidatePaths) {
      try {
        const content = await fs.readFile(candidate, "utf-8")
        const parsed = JSON.parse(content) as TemplateLayoutConfig
        return NextResponse.json(parsed)
      } catch {}
    }

    // If layout does not exist, return defaults
    return NextResponse.json(DEFAULT_TEMPLATE_LAYOUT)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not fetch template layout." },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { templateKey, layout } = body as {
      templateKey: string
      layout: Partial<TemplateLayoutConfig>
    }

    if (!templateKey || typeof templateKey !== "string") {
      return NextResponse.json({ error: "A valid templateKey is required." }, { status: 400 })
    }

    const templateId = normalizeTemplateId(templateKey)
    const dataDir = process.env.DATA_DIR && fsSync.existsSync(process.env.DATA_DIR)
      ? path.resolve(process.env.DATA_DIR)
      : path.resolve(process.cwd(), "data")
    const templatesDirectory = path.resolve(dataDir, "templates")
    await fs.mkdir(templatesDirectory, { recursive: true })

    const mergedLayout: TemplateLayoutConfig = {
      xPercent: Math.max(0, Math.min(100, Number(layout?.xPercent ?? DEFAULT_TEMPLATE_LAYOUT.xPercent))),
      yPercent: Math.max(0, Math.min(100, Number(layout?.yPercent ?? DEFAULT_TEMPLATE_LAYOUT.yPercent))),
      fontSize: Math.max(12, Math.min(80, Number(layout?.fontSize ?? DEFAULT_TEMPLATE_LAYOUT.fontSize))),
      fontFamily: layout?.fontFamily || DEFAULT_TEMPLATE_LAYOUT.fontFamily,
      fontWeight: layout?.fontWeight === "normal" ? "normal" : "bold",
      color: layout?.color && /^#[0-9a-fA-F]{6}$/.test(layout.color) ? layout.color : DEFAULT_TEMPLATE_LAYOUT.color,
      textAlign: layout?.textAlign === "left" || layout?.textAlign === "right" ? layout.textAlign : "center",
    }

    const jsonStr = JSON.stringify(mergedLayout, null, 2)
    const filePath = path.join(templatesDirectory, `${templateId}.json`)
    await fs.writeFile(filePath, jsonStr, "utf-8")

    // If templateKey has event: prefix, write stripped version too for issue compatibility
    if (templateId.startsWith("custom-event-")) {
      const strippedId = `custom-${templateId.slice("custom-event-".length)}`
      await fs.writeFile(path.join(templatesDirectory, `${strippedId}.json`), jsonStr, "utf-8")
    }

    return NextResponse.json({ success: true, templateId, layout: mergedLayout })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save template layout." },
      { status: 500 }
    )
  }
}
