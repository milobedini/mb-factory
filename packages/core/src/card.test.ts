import { describe, expect, it } from 'vitest';

import type { CardInput, CardRun } from './card';
import { CARD_COLOURS, readNextIssues, workItemCard } from './card';
import type { SlackBlock } from './slack';

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));

const run = (overrides: Partial<CardRun> = {}): CardRun => ({
  id: '11111111-1111-4111-8111-111111111111',
  agent: 'triage',
  trigger: 'delegated',
  status: 'finished',
  outcome: 'done',
  summary: null,
  costUsd: 0.25,
  durationMs: 60_000,
  createdAt: at(0),
  dispatchedAt: at(0),
  startedAt: at(1),
  finishedAt: at(2),
  actionsRunUrl: 'https://github.com/o/r/actions/runs/1',
  ...overrides
});

const input = (overrides: Partial<CardInput> = {}, workItem: Partial<CardInput['workItem']> = {}): CardInput => ({
  workItem: {
    id: '22222222-2222-4222-8222-222222222222',
    identifier: 'TAS-38',
    url: 'https://linear.app/tastebook/issue/TAS-38',
    title: 'Recipe details',
    stage: 'building',
    repository: 'milobedini/tastebook',
    branch: 'tas-38',
    prNumber: null,
    estimate: 3,
    reviewRounds: 0,
    updatedAt: at(30),
    project: { name: 'Real recipes', url: 'https://linear.app/tastebook/project/real-recipes' },
    milestone: 'Structured recipes',
    assignee: 'Milo Bedini',
    ...workItem
  },
  runs: [run()],
  round: [],
  hold: null,
  gate: undefined,
  rerunnable: false,
  questionsUrl: null,
  next: [],
  now: at(30),
  timeZone: 'Europe/London',
  emojiPrefix: 'tb',
  ...overrides
});

const attachment = (card: ReturnType<typeof workItemCard>) => {
  const [first] = card.attachments;
  if (!first) {
    throw new Error('no attachment');
  }
  return first;
};

const texts = (blocks: SlackBlock[]): string[] =>
  blocks.flatMap((block) => {
    const text = (block.text as { text?: string } | undefined)?.text;
    const elements = (block.elements as { text?: string }[] | undefined) ?? [];
    return [text, ...elements.map((element) => element.text)].filter((value) => value !== undefined);
  });

const track = (card: ReturnType<typeof workItemCard>): string => texts(attachment(card).blocks)[0] ?? '';

const status = (card: ReturnType<typeof workItemCard>): string => texts(attachment(card).blocks)[1] ?? '';

const buttons = (card: ReturnType<typeof workItemCard>): { text: string; url?: string; value?: string }[] =>
  attachment(card).blocks.flatMap((block) =>
    block.type === 'actions'
      ? (block.elements as { text: { text: string }; url?: string; value?: string }[]).map(({ text, url, value }) => ({
          text: text.text,
          url,
          value
        }))
      : []
  );

describe('workItemCard', () => {
  it('shows a running stage on the track, with skipped stages struck through and the rest to do', () => {
    const card = workItemCard(
      input({ runs: [run(), run({ agent: 'implement', status: 'running', finishedAt: null })] })
    );
    expect(attachment(card).color).toBe(CARD_COLOURS.running);
    expect(track(card)).toBe(
      ':tb-done: Triage   :tb-skipped: ~Spec~   :tb-running: *Implement*   :tb-todo: Verify   :tb-todo: Review   :tb-todo: Merge'
    );
    expect(status(card)).toBe(':tb-running: *Implementing* · <!date^1793095260^started {ago}|started at 10:01>');
    expect(card.text).toBe('TAS-38 Recipe details: running');
  });

  it('follows the run that’s going, not a reply’s run queued behind it', () => {
    const card = workItemCard(
      input({
        runs: [
          run(),
          run({ agent: 'implement', trigger: 'prompted', status: 'running', finishedAt: null }),
          run({ agent: 'implement', trigger: 'prompted', status: 'queued', dispatchedAt: null, startedAt: null })
        ],
        hold: { reason: 'work_item_busy', releaseAt: null }
      })
    );
    expect(track(card)).toContain(':tb-running: *Implement*');
    expect(status(card)).toContain('*Implementing*');
  });

  it('puts the title above the attachment, linked to the issue', () => {
    expect(texts(workItemCard(input()).blocks)).toEqual([
      '*<https://linear.app/tastebook/issue/TAS-38|TAS-38> Recipe details*'
    ]);
  });

  it('gives the size as its emoji and word, the project and milestone, who it’s for, and the runs’ totals', () => {
    const card = workItemCard(input({ runs: [run(), run({ agent: 'implement', status: 'running', costUsd: null })] }));
    expect(texts(attachment(card).blocks)).toContain(
      ':tb-size-m: Medium · <https://linear.app/tastebook/project/real-recipes|Real recipes> › Structured recipes · Milo Bedini · 2 runs · 2 min · $0.25'
    );
  });

  it('leaves out what isn’t known', () => {
    const card = workItemCard(
      input({ runs: [] }, { estimate: null, project: null, assignee: null, stage: 'researching' })
    );
    expect(attachment(card).blocks.filter((block) => block.type === 'context')).toHaveLength(1);
  });

  it('describes a revision by why it started, and a review by its PR and round', () => {
    const fixing = workItemCard(
      input({ runs: [run({ agent: 'implement', trigger: 'review_findings', status: 'running', finishedAt: null })] })
    );
    expect(status(fixing)).toContain('*Fixing the review findings*');
    const reviewing = workItemCard(
      input(
        { runs: [run({ agent: 'review', trigger: 'delivered', status: 'dispatched', startedAt: null })] },
        { prNumber: 40, reviewRounds: 1, stage: 'in_review' }
      )
    );
    expect(status(reviewing)).toContain('*Reviewing PR #40, round 2*');
    expect(buttons(reviewing).map(({ text }) => text)).toEqual(['PR #40', 'Run log']);
  });

  it('shows a queued run with the governor’s reason and when it should start', () => {
    const card = workItemCard(
      input({
        runs: [run({ status: 'queued', dispatchedAt: null, startedAt: null, finishedAt: null })],
        hold: { reason: 'five_hour_pause', releaseAt: at(60) }
      })
    );
    expect(attachment(card).color).toBe(CARD_COLOURS.queued);
    expect(status(card)).toBe(':tb-queued: *Queued* until 11:00: usage in the 5-hour window is close to the limit.');
    expect(track(card)).toMatch(/^:tb-queued: \*Triage\*/);
  });

  it('waits on the spec with the gate’s buttons and a link to the spec', () => {
    const card = workItemCard(
      input({ runs: [run(), run({ agent: 'spec', finishedAt: at(9) })] }, { stage: 'spec_review' })
    );
    expect(attachment(card).color).toBe(CARD_COLOURS.waiting);
    expect(track(card)).toMatch(/^:tb-done: Triage {3}:tb-needs-you: \*Spec\*/);
    expect(status(card)).toBe(':tb-needs-you: *Waiting on you:* approve the spec.');
    expect(buttons(card)).toEqual([
      { text: 'Approve', value: JSON.stringify({ w: '22222222-2222-4222-8222-222222222222', a: 'Approve' }) },
      {
        text: 'Change something',
        value: JSON.stringify({ w: '22222222-2222-4222-8222-222222222222', a: 'Change something' })
      },
      { text: 'Read the spec', url: 'https://github.com/milobedini/tastebook/blob/tas-38/specs/TAS-38.md' }
    ]);
  });

  it('points open questions at the thread, counting the answered ones', () => {
    const card = workItemCard(
      input(
        {
          runs: [run(), run({ agent: 'review', outcome: 'needs_input' })],
          round: [
            { answeredAt: at(5), closedAt: null, askedAt: at(3), createdAt: at(2) },
            { answeredAt: null, closedAt: null, askedAt: at(5), createdAt: at(2) },
            { answeredAt: null, closedAt: null, askedAt: null, createdAt: at(2) }
          ],
          questionsUrl: 'https://slack.test/archives/C1/p1'
        },
        { stage: 'awaiting_merge', prNumber: 40 }
      )
    );
    expect(status(card)).toBe(':tb-needs-you: *Waiting on you:* 2 questions from review (1 answered).');
    expect(track(card)).toContain(':tb-needs-you: *Review*');
    expect(buttons(card)).toEqual([{ text: 'Answer in the thread', url: 'https://slack.test/archives/C1/p1' }]);
  });

  it('offers a reported gate’s options, the suggestion first', () => {
    const card = workItemCard(
      input(
        {
          runs: [run({ outcome: 'needs_input' })],
          gate: { body: '## Slice Real recipes into 16 issues\n\nDetails…', options: ['File them', 'Change something'] }
        },
        { stage: 'researching' }
      )
    );
    expect(status(card)).toBe(':tb-needs-you: *Waiting on you:* Slice Real recipes into 16 issues');
    expect(buttons(card).map(({ text }) => text)).toEqual(['File them', 'Change something']);
  });

  it('shows a blocked run in red with what to change, and Re-run when it can run again', () => {
    const blocked = run({ agent: 'implement', outcome: 'blocked', summary: 'Add BLOB_READ_WRITE_TOKEN, then re-run.' });
    const card = workItemCard(input({ runs: [run(), blocked], rerunnable: true }));
    expect(attachment(card).color).toBe(CARD_COLOURS.blocked);
    expect(status(card)).toBe(':tb-blocked: *Blocked:* Add BLOB_READ_WRITE_TOKEN, then re-run.');
    expect(track(card)).toContain(':tb-blocked: *Implement*');
    expect(buttons(card).map(({ text }) => text)).toEqual(['Re-run', 'Run log']);
    expect(buttons(workItemCard(input({ runs: [run(), blocked] }))).map(({ text }) => text)).toEqual(['Run log']);
  });

  it('says a failed run failed', () => {
    const card = workItemCard(input({ runs: [run({ outcome: 'failed', summary: null })] }, { stage: 'researching' }));
    expect(status(card)).toBe(':tb-blocked: *The triage run failed.*');
  });

  it('is green at the merge gate, with the PR to open', () => {
    const card = workItemCard(
      input(
        { runs: [run(), run({ agent: 'implement' }), run({ agent: 'review' })] },
        { stage: 'awaiting_merge', prNumber: 38 }
      )
    );
    expect(attachment(card).color).toBe(CARD_COLOURS.ready);
    expect(track(card)).toBe(
      ':tb-done: Triage   :tb-skipped: ~Spec~   :tb-done: Implement   :tb-skipped: ~Verify~   :tb-done: Review   :tb-needs-you: *Merge*'
    );
    expect(status(card)).toBe(':tb-done: *Ready to merge:* review accepted PR #38 at 10:02.');
    expect(buttons(card)).toEqual([
      { text: 'Approve and merge', value: JSON.stringify({ m: '22222222-2222-4222-8222-222222222222' }) },
      { text: 'Open PR #38', url: 'https://github.com/milobedini/tastebook/pull/38' }
    ]);
  });

  it('asks to confirm a merge, with what review said to check first', () => {
    const card = workItemCard(
      input(
        {
          runs: [run(), run({ agent: 'review' })],
          beforeMerging: 'Check the seed recipes read well.',
          mergeEffect: 'deploys it to production'
        },
        { stage: 'awaiting_merge', prNumber: 38 }
      )
    );
    const merge = attachment(card)
      .blocks.flatMap((block) => (block.type === 'actions' ? (block.elements as SlackBlock[]) : []))
      .find((element) => element.action_id === 'merge');
    expect(merge?.confirm).toEqual({
      title: { type: 'plain_text', text: 'Merge PR #38?' },
      text: {
        type: 'plain_text',
        text: 'You’ll approve PR #38 on GitHub as yourself and merge it, which deploys it to production.\n\nBefore merging: Check the seed recipes read well.'
      },
      confirm: { type: 'plain_text', text: 'Approve and merge' },
      deny: { type: 'plain_text', text: 'Not yet' },
      style: 'primary'
    });
  });

  it('settles once merged, offering the issue it made ready', () => {
    const card = workItemCard(
      input(
        {
          runs: [run(), run({ agent: 'implement' }), run({ agent: 'review' })],
          next: [{ identifier: 'TAS-31', title: 'Enamel part 3', url: 'https://linear.app/t/TAS-31', size: 'M' }]
        },
        { stage: 'done', prNumber: 36 }
      )
    );
    expect(attachment(card).color).toBe(CARD_COLOURS.merged);
    expect(track(card)).toContain(':tb-done: Merge');
    expect(status(card)).toBe(':tb-merged: *Merged* at 10:30 · PR #36');
    const next = attachment(card).blocks.find((block) => block.accessory !== undefined);
    expect(next?.text).toEqual({
      type: 'mrkdwn',
      text: '*Next:* <https://linear.app/t/TAS-31|TAS-31> Enamel part 3 · :tb-size-m: Medium · ready to delegate'
    });
    expect(next?.accessory).toMatchObject({ value: JSON.stringify({ d: ['TAS-31'] }) });
  });

  it('says who delegated the next issue, or that it isn’t ready any more', () => {
    const card = workItemCard(
      input(
        {
          next: [
            {
              identifier: 'TAS-31',
              title: 'Part 3',
              url: 'https://l/31',
              size: 'unsized',
              delegatedBy: 'Milo',
              delegatedAt: at(40).toISOString()
            },
            { identifier: 'TAS-32', title: 'Part 4', url: 'https://l/32', size: 'S', notReady: true }
          ]
        },
        { stage: 'done' }
      )
    );
    expect(texts(attachment(card).blocks)).toEqual(
      expect.arrayContaining([
        '✓ Next: <https://l/31|TAS-31> Part 3 · delegated by Milo, 10:40',
        'Next: ~<https://l/32|TAS-32> Part 4 · :tb-size-s: Small~ · no longer ready'
      ])
    );
  });

  it('marks the stages after a cancel as canceled', () => {
    const card = workItemCard(input({ runs: [run(), run({ agent: 'implement' })] }, { stage: 'canceled' }));
    expect(track(card)).toBe(
      ':tb-done: Triage   :tb-skipped: ~Spec~   :tb-canceled: *Implement*   :tb-canceled: Verify   :tb-canceled: Review   :tb-canceled: Merge'
    );
    expect(status(card)).toBe(':tb-canceled: *Canceled* at 10:30');
  });

  it('names the emoji after the project’s prefix', () => {
    const card = workItemCard(input({ emojiPrefix: 'mbf' }));
    expect(track(card)).toMatch(/^:mbf-needs-you: \*Triage\*/);
    expect(texts(attachment(card).blocks)).toContain(
      ':mbf-size-m: Medium · <https://linear.app/tastebook/project/real-recipes|Real recipes> › Structured recipes · Milo Bedini · 1 run · 1 min · $0.25'
    );
  });

  it('escapes what people wrote', () => {
    const card = workItemCard(input({}, { title: 'Use <b> & co' }));
    expect(texts(card.blocks)[0]).toContain('Use &lt;b&gt; &amp; co');
  });
});

describe('readNextIssues', () => {
  it('reads what was stored and drops anything else', () => {
    expect(readNextIssues(null)).toEqual([]);
    expect(readNextIssues([{ identifier: 'TAS-1' }])).toEqual([]);
    expect(readNextIssues([{ identifier: 'TAS-1', title: 'A', url: 'https://l/1', size: 'XS' }])).toEqual([
      { identifier: 'TAS-1', title: 'A', url: 'https://l/1', size: 'XS' }
    ]);
  });
});
