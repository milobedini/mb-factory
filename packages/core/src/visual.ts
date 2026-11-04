import { z } from 'zod';

import type { SlackBlock } from './slack';
import { escapeSlack } from './slack';

// A PR's one visual: a collage of its screens, or a walkthrough's poster and the video itself. Implement records it,
// and the stage workflow's evidence job, with no agent present, builds it, uploads it to the project's public Blob
// store and writes where it is into implement's report as `visual`.

export type Visual = { title: string; image: string; video?: string; seconds?: number };

const TITLE_LIMIT = 150;

// Only the evidence store's public URLs: the report is the agent's file until the evidence job rewrites it.
const blobUrl = z.url({ protocol: /^https$/, hostname: /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/ });

const visualSchema = z.object({
  title: z.string().trim().min(1),
  image: blobUrl,
  video: blobUrl.optional(),
  seconds: z.int().positive().optional()
});

export const readVisual = (report: unknown): Visual | undefined => {
  const parsed = z.object({ visual: visualSchema }).safeParse(report);
  if (!parsed.success) {
    return undefined;
  }
  const { title, ...rest } = parsed.data.visual;
  const oneLine = title.replace(/\s+/g, ' ');
  return { ...rest, title: oneLine.length > TITLE_LIMIT ? `${oneLine.slice(0, TITLE_LIMIT - 1)}…` : oneLine };
};

const length = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// The visual in a Slack message: the image under its title, and for a video a link to play it, which stays when the
// message's buttons are cleared.
export const visualBlocks = (visual: Visual): SlackBlock[] => [
  {
    type: 'image',
    image_url: visual.image,
    alt_text: visual.title,
    title: { type: 'plain_text', text: visual.title }
  },
  ...(visual.video
    ? [
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `<${escapeSlack(visual.video)}|Play the walkthrough> (${visual.seconds ? `${length(visual.seconds)}, ` : ''}opens in the browser)`
            }
          ]
        }
      ]
    : [])
];
