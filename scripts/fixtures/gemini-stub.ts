/**
 * Test double for lib/gemini.ts. scripts/validate-atlas-fit.mjs bundles the
 * identification module against this instead of the real client, so the
 * parsing can be exercised without a network call or an API key.
 */
export const queue: string[] = [];

/** Mirrors the real error class so failure classification can be exercised. */
export class GeminiError extends Error {
  readonly status: number;
  readonly quota: boolean;
  readonly retryAfter: number;

  constructor(message: string, status: number, quota: boolean, retryAfter: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.quota = quota;
    this.retryAfter = retryAfter;
  }
}

/**
 * Queue a plain string to be returned, or a GeminiError to be thrown - the
 * two things the real client can do.
 */
export const errorQueue: GeminiError[] = [];

export async function analyzeImageWithGemini(): Promise<string> {
  if (errorQueue.length) throw errorQueue.shift()!;
  if (!queue.length) throw new Error('stub: no reply queued');
  return queue.shift()!;
}
