/**
 * A Gemini call that failed in a way the caller can act on. `quota` marks the
 * case where retrying is pointless because the key's allowance is spent, as
 * opposed to a momentary rate spike.
 */
export class GeminiError extends Error {
  readonly status: number;
  readonly quota: boolean;
  /** Seconds Google asked us to wait, when it said so. */
  readonly retryAfter: number;

  constructor(message: string, status: number, quota: boolean, retryAfter: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.quota = quota;
    this.retryAfter = retryAfter;
  }
}

/** Seconds from the RetryInfo block Google attaches to a 429, e.g. "42.6s". */
function readRetryDelay(body: string): number {
  try {
    const details = JSON.parse(body)?.error?.details;
    if (!Array.isArray(details)) return 0;
    for (const detail of details) {
      const delay = detail?.retryDelay;
      if (typeof delay === 'string') {
        const seconds = Number.parseFloat(delay);
        if (Number.isFinite(seconds)) return seconds;
      }
    }
  } catch {
    /* fall through to no delay */
  }
  return 0;
}

/** Longest delay worth waiting out inline before giving the user the error. */
const MAX_INLINE_WAIT_SECONDS = 12;

export async function analyzeImageWithGemini(base64Image: string, prompt: string): Promise<string> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key not found. Add VITE_GEMINI_API_KEY or GEMINI_API_KEY to your .env file.');
  }

  // Keep the data URI prefix off, and detect the real mime type from it.
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,/.exec(base64Image);
  const mimeType = match ? match[1].replace('image/jpg', 'image/jpeg') : 'image/jpeg';
  const base64Data = base64Image.replace(/^data:image\/(?:png|jpeg|jpg|webp);base64,/, '');

  // `gemini-flash-latest` is a moving alias to the current fast model. The old
  // `gemini-1.5-flash-latest` was retired by Google and now returns 404.
  const model = import.meta.env.VITE_GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Data } },
        ],
      },
    ],
  };

  // Retry transient 503 "high demand" / 429 rate-limit spikes. When Google
  // states a retry delay, honour it rather than a guess of our own - but only
  // if it is short enough to wait out; a spent daily quota reports tens of
  // seconds or more and no amount of retrying inside one call will clear it.
  let response: Response | undefined;
  let errorText = '';
  let retryAfter = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) break;
    errorText = await response.text();
    if (response.status !== 503 && response.status !== 429) break;

    retryAfter = readRetryDelay(errorText);
    if (retryAfter > MAX_INLINE_WAIT_SECONDS) break;
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1200 * (attempt + 1);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (!response || !response.ok) {
    console.error('Gemini API Error:', errorText);
    let message = errorText;
    try {
      message = JSON.parse(errorText)?.error?.message || errorText;
    } catch {
      /* keep raw text */
    }
    const status = response?.status ?? 0;
    // "quota" in the message is how the free tier reports an exhausted
    // allowance; a plain 429 without it is a burst that will pass.
    const quota = status === 429 && /quota|billing/i.test(message);
    throw new GeminiError(
      `Gemini request failed (${status || 'no response'}): ${message}`,
      status,
      quota,
      retryAfter,
    );
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) return text;

  const blocked = data?.promptFeedback?.blockReason;
  return blocked ? `Gemini blocked the request (${blocked}).` : 'No response generated.';
}
