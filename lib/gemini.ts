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

  // Retry transient 503 "high demand" / 429 rate-limit spikes with a short backoff.
  let response: Response | undefined;
  let errorText = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.ok) break;
    errorText = await response.text();
    if (response.status !== 503 && response.status !== 429) break;
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }

  if (!response || !response.ok) {
    console.error('Gemini API Error:', errorText);
    let message = errorText;
    try {
      message = JSON.parse(errorText)?.error?.message || errorText;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Gemini request failed (${response?.status ?? 'no response'}): ${message}`);
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
