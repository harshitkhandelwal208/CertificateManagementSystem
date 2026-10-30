import { NextResponse } from "next/server"
import fs from "node:fs/promises"
import path from "node:path"

export async function GET(request: Request) {
  const bold = new URL(request.url).searchParams.get("weight") === "bold"
  const name = bold ? "timesbd.ttf" : "times.ttf"
  const configured = process.env[bold ? "CERTIFICATE_TIMES_BOLD" : "CERTIFICATE_TIMES_REGULAR"]
  const candidates = [configured, process.platform === "win32" ? path.join(process.env.WINDIR || "C:\\Windows", "Fonts", name) : undefined, `/usr/share/fonts/truetype/msttcorefonts/${name}`, `/usr/share/fonts/truetype/msttcorefonts/${name.toUpperCase()}`]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const bytes = await fs.readFile(candidate)
      return new Response(bytes, { headers: { "Content-Type": "font/ttf", "Cache-Control": "private, max-age=3600" } })
    } catch {}
  }
  return NextResponse.json({ error: "Times New Roman font is not installed." }, { status: 404 })
}
