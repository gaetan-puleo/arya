import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeImage, type VisionConfig } from './provider';

const cfg: VisionConfig = { baseUrl: 'http://vision.test/v1', apiKey: 'k', model: 'vision-model' };

afterEach(() => vi.restoreAllMocks());

describe('describeImage', () => {
  it('posts a data-url image and returns the model text', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://vision.test/v1/chat/completions');
      const body = JSON.parse(String(init.body)) as {
        model: string;
        messages: { role: string; content: { type: string; text?: string; image_url?: { url: string } }[] }[];
      };
      expect(body.model).toBe('vision-model');
      expect(body.messages[0].content[0].text).toBe('what is here?');
      expect(body.messages[0].content[1].image_url?.url).toMatch(/^data:image\/png;base64,/);
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '  a red button  ' } }] }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await describeImage({ mime: 'image/png', data: new Uint8Array([1, 2, 3]) }, 'what is here?', cfg);
    expect(out).toBe('a red button');
  });

  it('throws with status on a failed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response),
    );
    await expect(
      describeImage({ mime: 'image/png', data: new Uint8Array([0]) }, 'q', cfg),
    ).rejects.toThrow(/vision: 500/);
  });
});
