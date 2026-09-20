import { type ContentPart, text } from 'mu-core';
import type { Tool } from 'mu-core';
import { describeImage, type CapturedImage, type VisionConfig } from './provider';

const asObj = (input: unknown): Record<string, unknown> =>
  (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export interface VisionToolsDeps {
  /** Capture a screenshot to analyze (e.g. pc.screenshot or browser.screenshot). */
  capture: () => Promise<CapturedImage>;
  /** Vision model config. When absent, the tool reports that vision is not wired. */
  vision?: VisionConfig;
}

/**
 * "Vision on demand": the chat model calls screen_analyze with a question; we
 * capture the screen and ask a vision model to answer it in text. Lets a
 * non-vision chat model (halogen) still reason about what's on screen.
 */
export const createVisionTools = (deps: VisionToolsDeps): Tool[] => [
  {
    name: 'screen_analyze',
    description:
      'Capture the screen and ask a vision model a question about it (e.g. "what buttons are visible?", "read the dialog text"). Returns text. Requires a vision model configured (ARYA_VISION_*).',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    },
    run: async (input, ctx): Promise<ContentPart[]> => {
      if (!deps.vision) {
        return [
          text(
            'vision not configured — set ARYA_VISION_BASE_URL / ARYA_VISION_MODEL (a vision-capable model) to enable screen analysis. Prefer browser_snapshot / pc_window_list for structured reads.',
          ),
        ];
      }
      const shot = await deps.capture();
      const answer = await describeImage(shot, str(asObj(input).question) || 'Describe what is on screen.', deps.vision, ctx.signal);
      return [text(answer || '(no answer)')];
    },
  },
];
