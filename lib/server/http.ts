import { NextResponse } from 'next/server'
export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
export function apiError(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 })
  if (typeof error === 'object' && error && 'code' in error && error.code === '23505') return NextResponse.json({ error: 'This record already exists.' }, { status: 409 })
  console.error('API request failed', error instanceof Error ? error.name : 'unknown')
  return NextResponse.json({ error: 'The request could not be completed. Please try again.' }, { status: 500 })
}
export function stringField(value: unknown, name: string, max = 200, required = true): string {
  if ((value === undefined || value === null || value === '') && !required) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(`A valid ${name} is required (maximum ${max} characters).`)
  return value.trim()
}
export function pageNumber(value: string | null, fallback: number, max = 1000000) {
  if (value === null) return fallback
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new ApiError('Invalid pagination parameters.')
  return Number(value)
}
