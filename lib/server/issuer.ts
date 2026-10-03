import { execFile } from "node:child_process"
import path from "node:path"

import type { TemplateLayoutConfig } from "@/lib/template-layout"

const dllPath = path.resolve(process.cwd(), "src/CertificateEngine/bin/Debug/net8.0/CertificateEngine.dll")

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

export function issueSingleCertificate(params: SingleIssueParams): Promise<SingleIssueResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(params)
    execFile("dotnet", [dllPath, "issue", payload], (err, stdout, stderr) => {
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
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(params)
    execFile("dotnet", [dllPath, "issue-batch", payload], (err, stdout, stderr) => {
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
