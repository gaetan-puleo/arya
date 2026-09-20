export interface VisionConfig {
  /** OpenAI-compatible base URL, e.g. http://host:port/v1 */
  baseUrl: string;
  apiKey?: string;
  /** A vision-capable model id (halogen has none — point at a vision model). */
  model: string;
  timeoutMs?: number;
}

export interface CapturedImage {
  mime: string;
  data: Uint8Array;
}

const toBase64 = (u8: Uint8Array): string => Buffer.from(u8).toString('base64');

/**
 * Send one image + a prompt to an OpenAI-compatible vision model and return the
 * text answer. This is the "vision on demand" path: the chat model (which may have
 * no vision) asks for a description of a screenshot instead of seeing it.
 */
export const describeImage = async (
  image: CapturedImage,
  prompt: string,
  cfg: VisionConfig,
  signal?: AbortSignal,
): Promise<string> => {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: cfg.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${image.mime};base64,${toBase64(image.data)}` } },
        ],
      },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`vision: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return json.choices?.[0]?.message?.content?.trim() ?? '';
};
