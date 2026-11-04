import { describe, expect, it } from 'vitest';

import { slackAcceptedMessage, slackMergeSettled } from './merge';
import { readVisual, visualBlocks } from './visual';

const prefix = 'https://abc123.public.blob.vercel-storage.com/o/tastebook/run-1/';

describe('readVisual', () => {
  it('reads a collage, and a video with its poster and length', () => {
    expect(readVisual({ visual: { title: 'What changed:\n the form', image: `${prefix}visual.png` } })).toEqual({
      title: 'What changed: the form',
      image: `${prefix}visual.png`
    });
    expect(
      readVisual({
        visual: { title: 'Walkthrough', image: `${prefix}poster.png`, video: `${prefix}walkthrough.mp4`, seconds: 24 }
      })
    ).toEqual({ title: 'Walkthrough', image: `${prefix}poster.png`, video: `${prefix}walkthrough.mp4`, seconds: 24 });
  });

  it('reads nothing that isn’t on the evidence store, or has no title', () => {
    expect(readVisual({ visual: { title: 'T', image: 'https://example.com/visual.png' } })).toBeUndefined();
    expect(
      readVisual({ visual: { title: 'T', image: `${prefix}visual.png`, video: 'http://x.com/v.mp4' } })
    ).toBeUndefined();
    expect(
      readVisual({ visual: { title: 'T', image: 'http://abc123.public.blob.vercel-storage.com/v.png' } })
    ).toBeUndefined();
    expect(readVisual({ visual: { title: ' ', image: `${prefix}visual.png` } })).toBeUndefined();
    expect(readVisual({ summary: 'no visual' })).toBeUndefined();
    expect(readVisual(null)).toBeUndefined();
  });

  it('clips a long title', () => {
    expect(readVisual({ visual: { title: 'x'.repeat(200), image: `${prefix}visual.png` } })?.title).toHaveLength(150);
  });
});

describe('visualBlocks', () => {
  it('shows a collage as an image under its title', () => {
    expect(visualBlocks({ title: 'What changed: the form', image: `${prefix}visual.png` })).toEqual([
      {
        type: 'image',
        image_url: `${prefix}visual.png`,
        alt_text: 'What changed: the form',
        title: { type: 'plain_text', text: 'What changed: the form' }
      }
    ]);
  });

  it('links a video under its poster, with its length', () => {
    const [, link] = visualBlocks({
      title: 'Walkthrough',
      image: `${prefix}poster.png`,
      video: `${prefix}walkthrough.mp4`,
      seconds: 84
    });
    expect(link).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<${prefix}walkthrough.mp4|Play the walkthrough> (1:24, opens in the browser)` }
      ]
    });
  });

  it('sits between review’s text and Before merging, and stays once the merge is settled', () => {
    const message = slackAcceptedMessage('The review run finished.', {
      workItemId: '22222222-2222-4222-8222-222222222222',
      prNumber: 39,
      prUrl: 'https://github.com/o/r/pull/39',
      beforeMerging: 'Run the migration.',
      mergeEffect: undefined,
      visual: { title: 'Walkthrough', image: `${prefix}poster.png`, video: `${prefix}walkthrough.mp4`, seconds: 24 }
    });
    expect(message.blocks.map((block) => block.type)).toEqual(['section', 'image', 'context', 'section', 'actions']);
    expect(slackMergeSettled(message.blocks, 'Merged.').map((block) => block.type)).toEqual([
      'section',
      'image',
      'context',
      'section',
      'section'
    ]);
  });
});
