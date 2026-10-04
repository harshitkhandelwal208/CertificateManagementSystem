import { execFile } from "node:child_process"
import path from "node:path"

import type { TemplateLayoutConfig } from "@/lib/template-layout"

export function getDllPath(): string {
  if (process.env.ENGINE_DLL_PATH && fs.existsSync(/*turbopackIgnore: true*/ process.env.ENGINE_DLL_PATH)) {
    return process.env.ENGINE_DLL_PATH
  }
  const candidates = [
    path.resolve("/app/engine/CertificateEngine.dll"),
    path.resolve(process.cwd(), "engine/CertificateEngine.dll"),
    path.resolve(process.cwd(), "src/CertificateEngine/bin/Release/net8.0/CertificateEngine.dll"),
    path.resolve(process.cwd(), "src/CertificateEngine/bin/Debug/net8.0/CertificateEngine.dll"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate
    }
  }
  return candidates[candidates.length - 1]
}

function getEngineCwd(): string {
  if (process.env.ENGINE_CWD && fs.existsSync(/*turbopackIgnore: true*/ process.env.ENGINE_CWD)) {
    return process.env.ENGINE_CWD
  }
  if (process.env.DATA_DIR && fs.existsSync(/*turbopackIgnore: true*/ process.env.DATA_DIR)) {
    return path.dirname(path.resolve(process.env.DATA_DIR))
  }
  return process.cwd()
}

export interface SingleIssueParams {
  fullName: string
  eventId?: string
  eventName?: string
  email?: string
  phone?: string
  templateId?: string
  layout?: TemplateLayoutConfig
}

export interface SingleIssueResult {
  publicId: string
  certificateNumber: string
  verifyPath: string
  artifactPath: string
  artifactSha256: string
}

export interface BatchRecipient {
  name: string
  email?: string
  phone?: string
}

export interface BatchIssueParams {
  eventId?: string
  eventName?: string
  templateId?: string
  recipients: BatchRecipient[]
  layout?: TemplateLayoutConfig
}

export interface BatchIssueResult {
  totalProcessed: number
  issuedCount: number
  results: Array<{
    publicId?: string
    certificateNumber?: string
    recipientName: string
    status: string
    verifyPath?: string
    error?: string
  }>
}

import fs from "node:fs"
import { getApiKey } from "@/lib/api"

export function issueSingleCertificate(params: SingleIssueParams): Promise<SingleIssueResult> {
  const engineUrl = process.env.ENGINE_URL
  const apiKey = getApiKey()

  if (engineUrl && engineUrl.startsWith("http")) {
    return (async () => {
      try {
        const res = await fetch(`${engineUrl.replace(/\/+$/, "")}/internal/demo/issue`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
          },
          body: JSON.stringify(params),
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Engine HTTP error ${res.status}: ${errText}`)
        }
        const data = await res.json()
        return {
          publicId: data.publicId,
          certificateNumber: data.certificateNumber,
          verifyPath: data.verifyPath,
          artifactPath: `certificates/${data.publicId}.pdf`,
          artifactSha256: "",
        } as SingleIssueResult
      } catch (err: any) {
        const fallbackDll = getDllPath()
        if (!fs.existsSync(/*turbopackIgnore: true*/ fallbackDll)) throw err
        return executeSingleCli(params)
      }
    })()
  }

  return executeSingleCli(params)
}

function executeSingleCli(params: SingleIssueParams): Promise<SingleIssueResult> {
  return new Promise((resolve, reject) => {
    const dllPath = getDllPath()
    if (!fs.existsSync(/*turbopackIgnore: true*/ dllPath)) {
      return reject(new Error(`CertificateEngine binary not found at ${dllPath}`))
    }
    const cwd = getEngineCwd()
    const payload = JSON.stringify(params)
    execFile("dotnet", [dllPath, "issue", payload], { cwd, env: { ...process.env } }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message))
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as SingleIssueResult
        resolve(parsed)
      } catch (parseError: any) {
        reject(new Error(`Failed to parse CLI output: ${stdout}`))
      }
    })
  })
}

export function issueBatchCertificates(params: BatchIssueParams): Promise<BatchIssueResult> {
  const engineUrl = process.env.ENGINE_URL
  const apiKey = getApiKey()

  if (engineUrl && engineUrl.startsWith("http")) {
    return (async () => {
      try {
        const res = await fetch(`${engineUrl.replace(/\/+$/, "")}/internal/issue/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
          },
          body: JSON.stringify(params),
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Engine HTTP error ${res.status}: ${errText}`)
        }
        const rawResults = await res.json()
        const results = rawResults.map((r: any) => ({
          publicId: r.data?.publicId,
          certificateNumber: r.data?.certificateNumber,
          recipientName: r.name,
          status: r.success ? "Issued" : "Failed",
          verifyPath: r.data?.verifyPath,
          error: r.error,
        }))
        return {
          totalProcessed: params.recipients.length,
          issuedCount: results.filter((r: any) => r.status === "Issued").length,
          results,
        } as BatchIssueResult
      } catch (err: any) {
        const fallbackDll = getDllPath()
        if (!fs.existsSync(/*turbopackIgnore: true*/ fallbackDll)) throw err
        return executeBatchCli(params)
      }
    })()
  }

  return executeBatchCli(params)
}

function executeBatchCli(params: BatchIssueParams): Promise<BatchIssueResult> {
  return new Promise((resolve, reject) => {
    const dllPath = getDllPath()
    if (!fs.existsSync(/*turbopackIgnore: true*/ dllPath)) {
      return reject(new Error(`CertificateEngine binary not found at ${dllPath}`))
    }
    const cwd = getEngineCwd()
    const payload = JSON.stringify(params)
    execFile("dotnet", [dllPath, "issue-batch", payload], { cwd, env: { ...process.env } }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error(stderr || err.message))
      }
      try {
        const parsed = JSON.parse(stdout.trim()) as BatchIssueResult
        resolve(parsed)
      } catch (parseError: any) {
        reject(new Error(`Failed to parse CLI output: ${stdout}`))
      }
    })
  })
}
