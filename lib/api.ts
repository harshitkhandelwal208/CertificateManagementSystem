export function getEngineUrl(): string {
  return process.env.ENGINE_URL || 'http://localhost:5000';
}

export function getApiKey(): string {
  return process.env.ENGINE_API_KEY || process.env.Platform__InternalApiKey || '';
}

export function getVerificationUrl(): string {
  return process.env.VERIFICATION_URL || 'http://localhost:5001';
}
