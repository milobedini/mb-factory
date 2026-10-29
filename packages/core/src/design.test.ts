import { describe, expect, it } from 'vitest';

import type { DesignBrief } from './design';
import {
  designCommitMessage,
  designFireText,
  dinoIssue,
  dinoWaitText,
  latestCanvas,
  latestSpecDesign,
  readCanvas,
  readDesignComponents,
  readDesignFiles,
  readDesignReportBody,
  readFiredSession,
  readSpecDesign
} from './design';

describe('readSpecDesign', () => {
  it('reads a call for design with the components it expects', () => {
    expect(
      readSpecDesign({
        design: {
          decision: 'needed',
          why: 'A new account menu and household screen.',
          components: [
            { name: 'Avatar', change: 'new' },
            { name: ' Button ', change: 'changed' }
          ]
        }
      })
    ).toEqual({
      needed: true,
      why: 'A new account menu and household screen.',
      components: [
        { name: 'Avatar', change: 'new' },
        { name: 'Button', change: 'changed' }
      ]
    });
  });

  it('reads a skip with its reason', () => {
    expect(
      readSpecDesign({ design: { decision: 'skip', why: 'Reuses the existing banner; no visual change.' } })
    ).toEqual({ needed: false, why: 'Reuses the existing banner; no visual change.' });
  });

  it('keeps well-formed components once each, dropping the rest', () => {
    expect(
      readSpecDesign({
        design: {
          decision: 'needed',
          why: 'A new screen.',
          components: [
            { name: 'Tabs', change: 'new' },
            { name: 'Tabs', change: 'changed' },
            { name: 'Switch', change: 'restyled' },
            { name: '', change: 'new' },
            'Avatar'
          ]
        }
      })
    ).toEqual({ needed: true, why: 'A new screen.', components: [{ name: 'Tabs', change: 'new' }] });
  });

  it('reads a call for design that lists no components', () => {
    expect(readSpecDesign({ design: { decision: 'needed', why: 'A new layout for the list.' } })).toEqual({
      needed: true,
      why: 'A new layout for the list.',
      components: []
    });
  });

  it('makes no call when the report has none or it is malformed', () => {
    expect(readSpecDesign({ summary: 'Spec written.' })).toBeNull();
    expect(readSpecDesign({ design: 'needed' })).toBeNull();
    expect(readSpecDesign({ design: { decision: 'maybe', why: 'Unsure.' } })).toBeNull();
    expect(readSpecDesign({ design: { decision: 'skip', why: ' ' } })).toBeNull();
    expect(readSpecDesign(null)).toBeNull();
  });
});

describe('latestSpecDesign', () => {
  const needed = { design: { decision: 'needed', why: 'A new screen.', components: [] } };
  const skip = { design: { decision: 'skip', why: 'No visual change.' } };

  it('takes the newest call', () => {
    expect(latestSpecDesign([skip, needed])).toEqual({ needed: false, why: 'No visual change.' });
  });

  it('keeps an earlier call when a revision leaves design out', () => {
    expect(latestSpecDesign([{ summary: 'Reworded the steps.' }, needed])).toEqual({
      needed: true,
      why: 'A new screen.',
      components: []
    });
  });

  it('makes no call when no report does', () => {
    expect(latestSpecDesign([{ summary: 'Spec written.' }])).toBeNull();
    expect(latestSpecDesign([])).toBeNull();
  });
});

describe('readCanvas', () => {
  it('reads a claude.ai canvas link, and nothing else', () => {
    expect(readCanvas({ canvas: 'https://claude.ai/artifact/9ENfcagd6BSq9LgLDHwCtv' })).toBe(
      'https://claude.ai/artifact/9ENfcagd6BSq9LgLDHwCtv'
    );
    expect(
      readCanvas({ canvas: 'https://claude.ai/code/artifact/a233622a-3a42-43b5-8831-d6fe5783bbf3' })
    ).not.toBeNull();
    expect(readCanvas({ canvas: 'https://example.com/artifact/abc' })).toBeNull();
    expect(readCanvas({ canvas: 'https://claude.ai/artifact/abc?x=1' })).toBeNull();
    expect(readCanvas({ summary: 'Drew it.' })).toBeNull();
  });

  it('takes the newest canvas from reports newest first', () => {
    const canvas = { canvas: 'https://claude.ai/artifact/first' };
    expect(latestCanvas([{ summary: 'Failed.' }, canvas])).toBe('https://claude.ai/artifact/first');
    expect(latestCanvas([])).toBeNull();
  });
});

describe('designFireText', () => {
  it('carries the brief as JSON the saved prompt can find', () => {
    const brief = {
      runId: 'run-1',
      reportUrl: 'https://console.example/api/runs/run-1/design',
      pass: '1793270000000.abc',
      issue: { identifier: 'TAS-90', url: 'https://linear.app/tastebook/issue/TAS-90', title: 'Households' },
      repository: 'milobedini/tastebook',
      branch: 'tas-90-households',
      pr: 70,
      trigger: 'spec_approved',
      prompt: null,
      canvas: null,
      design: { needed: true, why: 'A new screen.', components: [{ name: 'Avatar', change: 'new' }] }
    } satisfies DesignBrief;
    const text = designFireText(brief);
    expect(text.startsWith('mb-factory design run.')).toBe(true);
    expect(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))).toEqual(brief);
  });
});

describe('readFiredSession', () => {
  it('reads the session a fire started', () => {
    expect(
      readFiredSession({
        type: 'routine_fire',
        claude_code_session_id: 'session_01',
        claude_code_session_url: 'https://claude.ai/code/session_01'
      })
    ).toEqual({ sessionId: 'session_01', sessionUrl: 'https://claude.ai/code/session_01' });
    expect(readFiredSession({ claude_code_session_id: 'session_01' })).toBeNull();
  });
});

describe('readDesignReportBody', () => {
  it('reads the report a design session posts, and rejects anything else', () => {
    expect(readDesignReportBody({ report: { outcome: 'done' } })).toEqual({ report: { outcome: 'done' } });
    expect(readDesignReportBody(null)).toBeNull();
  });
});

describe('readDesignFiles', () => {
  const png = Buffer.from('png').toString('base64');

  it('reads flat board, picture and notes files', () => {
    const files = [
      { name: 'Household.dc.html', content: Buffer.from('<x-dc></x-dc>').toString('base64') },
      { name: 'Household.png', content: png },
      { name: 'notes.md', content: Buffer.from('# Notes').toString('base64') }
    ];
    expect(readDesignFiles({ report: {}, files })).toEqual(files);
  });

  it('sends nothing when the body has no files', () => {
    expect(readDesignFiles({ report: {} })).toBeUndefined();
  });

  it('refuses a path, another type, a repeated name or content that isn’t base64', () => {
    expect(readDesignFiles({ files: [{ name: '../AGENTS.md', content: png }] })).toBeNull();
    expect(readDesignFiles({ files: [{ name: 'nested/Board.html', content: png }] })).toBeNull();
    expect(readDesignFiles({ files: [{ name: 'run.sh', content: png }] })).toBeNull();
    expect(
      readDesignFiles({
        files: [
          { name: 'A.png', content: png },
          { name: 'A.png', content: png }
        ]
      })
    ).toBeNull();
    expect(readDesignFiles({ files: [{ name: 'A.png', content: 'not base64!' }] })).toBeNull();
    expect(readDesignFiles({ files: [] })).toBeNull();
  });
});

describe('hand-off text', () => {
  const feature = { identifier: 'TAS-90', url: 'https://linear.app/tastebook/issue/TAS-90' };

  it('credits the person the work is for on the design commit', () => {
    expect(designCommitMessage('TAS-90', 'Milo Bedini <1+milo@users.noreply.github.com>')).toBe(
      'Add the approved design for TAS-90\n\nCo-authored-by: Milo Bedini <1+milo@users.noreply.github.com>'
    );
    expect(designCommitMessage('TAS-90', null)).toBe('Add the approved design for TAS-90');
  });

  it('files a new component with a link to its board on the spec branch', () => {
    const issue = dinoIssue(
      feature,
      { name: 'Avatar', change: 'new' },
      {
        repository: 'milobedini/tastebook',
        branch: 'tas-90-households'
      }
    );
    expect(issue.title).toBe('Add Avatar to Dino');
    expect(issue.description).toContain(
      '(https://github.com/milobedini/tastebook/tree/tas-90-households/specs/TAS-90/design)'
    );
    expect(issue.description).toContain('It blocks TAS-90');
  });

  it('says what the feature waits on, in Slack and in Linear', () => {
    const filed = [{ identifier: 'TAS-91', url: 'https://linear.app/tastebook/issue/TAS-91' }];
    expect(dinoWaitText(filed)).toBe(
      'The design needs a new Dino component first: <https://linear.app/tastebook/issue/TAS-91|TAS-91>. Reply here once it’s done and building starts.'
    );
    expect(dinoWaitText(filed, 'markdown')).toContain('[TAS-91](https://linear.app/tastebook/issue/TAS-91)');
  });

  it('reads the components a design run reported', () => {
    expect(readDesignComponents({ components: [{ name: 'Avatar', change: 'new' }, 'Tabs'] })).toEqual([
      { name: 'Avatar', change: 'new' }
    ]);
  });
});
