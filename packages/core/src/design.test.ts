import { describe, expect, it } from 'vitest';

import type { DesignBrief } from './design';
import {
  acceptanceCriteria,
  designCommitMessage,
  designDecisions,
  designFireText,
  designIssueText,
  dinoIssue,
  dinoWaitText,
  latestCanvas,
  latestSpecDesign,
  latestTriageBrief,
  picksSpecChange,
  readCanvas,
  readDesignComponents,
  readDesignCoverage,
  readDesignFiles,
  readDesignReportBody,
  readDesignVariants,
  readFiredSession,
  readSpecDesign,
  readVariantPick,
  uncoveredCriteria,
  useVariantReply,
  withDesignReviewNotes
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

describe('readDesignVariants', () => {
  const variants = [
    { name: 'A', title: 'Stacked fieldsets' },
    { name: 'B', title: 'One row a line' }
  ];

  it('reads two or three variants, recommended first', () => {
    expect(readDesignVariants({ stage: 'design', variants })).toEqual(
      variants.map((variant) => ({ ...variant, specChange: null }))
    );
  });

  it('reads a spec change on any variant but the recommended one, which always fits the spec', () => {
    const changes = 'Fields move into a sheet.';
    expect(
      readDesignVariants({
        variants: [
          { name: 'A', title: 'Stacked', specChange: 'Ignored.' },
          { name: 'B', title: 'List and sheet', specChange: changes }
        ]
      })
    ).toEqual([
      { name: 'A', title: 'Stacked', specChange: null },
      { name: 'B', title: 'List and sheet', specChange: changes }
    ]);
  });

  it('reads none from a report without them, with one, with too many or with a name used twice', () => {
    expect(readDesignVariants({ stage: 'design' })).toEqual([]);
    expect(readDesignVariants({ variants: variants.slice(0, 1) })).toEqual([]);
    expect(
      readDesignVariants({ variants: [...variants, { name: 'C', title: 'c' }, { name: 'D', title: 'd' }] })
    ).toEqual([]);
    expect(readDesignVariants({ variants: [variants[0], { name: 'A', title: 'Again' }] })).toEqual([]);
    expect(readDesignVariants({ variants: [variants[0], { name: 'Bee', title: 'Long name' }] })).toEqual([]);
  });

  it('turns a pick into a reply the design run revises from', () => {
    expect(useVariantReply({ name: 'B', title: 'One row a line', specChange: null })).toBe(
      'Use variant B: One row a line'
    );
  });

  it('turns a pick that changes the spec into what the spec run changes', () => {
    const reply = useVariantReply({ name: 'C', title: 'List and sheet', specChange: 'Fields move into a sheet.' });
    expect(reply).toBe(
      "Use variant C, which changes the spec: List and sheet. Fields move into a sheet. Record the pick in the spec's Decisions, so the design is redrawn around variant C once the spec is approved."
    );
    expect(picksSpecChange(reply)).toBe(true);
    expect(readVariantPick(reply)).toBe('C');
    expect(picksSpecChange('Use variant B: One row a line')).toBe(false);
  });

  it('reads the variant a reply picks, and nothing from any other reply', () => {
    expect(readVariantPick('Use variant B: One row a line')).toBe('B');
    expect(readVariantPick(' use variant c ')).toBe('C');
    expect(readVariantPick('Use the other one')).toBeNull();
    expect(readVariantPick('Use variants Bee')).toBeNull();
  });
});

describe('designFireText', () => {
  it('carries the brief as JSON the saved prompt can find', () => {
    const brief = {
      runId: 'run-1',
      reportUrl: 'https://console.example/api/runs/run-1/design',
      pass: '1793270000000.abc',
      issue: { identifier: 'TAS-90', url: 'https://linear.app/tastebook/issue/TAS-90', title: 'Households' },
      issueText: '## Goal\n\nA household shares its recipes.',
      triageBrief: '**Triage brief**\n\n**Size:** M',
      criteria: ['A household shares its recipes.'],
      decisions: [{ question: 'Who can leave?', answer: 'Anyone but the last member.' }],
      repository: 'milobedini/tastebook',
      branch: 'tas-90-households',
      pr: 70,
      trigger: 'spec_approved',
      prompt: null,
      canvas: null,
      design: { needed: true, why: 'A new screen.', components: [{ name: 'Avatar', change: 'new' }] },
      track: 'careful' as const,
      designSystem: {
        url: 'https://claude.ai/artifact/Log29Ws2J3fTumoXaxVr1C',
        build: 'pnpm dino:bundle',
        out: 'frontend/dino-bundle'
      }
    } satisfies DesignBrief;
    const text = designFireText(brief);
    expect(text.startsWith('mb-factory design run.')).toBe(true);
    expect(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))).toEqual(brief);
  });
});

describe('latestTriageBrief', () => {
  it('picks the latest comment that is a triage brief', () => {
    expect(
      latestTriageBrief([
        { body: '**Triage brief**\n\n**Size:** S', createdAt: '2026-11-08T09:00:00Z' },
        { body: 'The stage ended without a valid report.', createdAt: '2026-11-08T11:00:00Z' },
        { body: '  **Triage brief**\n\n**Size:** L  ', createdAt: '2026-11-08T10:00:00Z' }
      ])
    ).toBe('**Triage brief**\n\n**Size:** L');
  });

  it('is null when triage posted no brief', () => {
    expect(
      latestTriageBrief([{ body: 'Triage done: size L. Brief is on the issue.', createdAt: '2026-11-08T10:00:00Z' }])
    ).toBeNull();
    expect(latestTriageBrief([])).toBeNull();
  });

  it('cuts a runaway brief', () => {
    const brief = latestTriageBrief([
      { body: `**Triage brief**\n${'x'.repeat(40_000)}`, createdAt: '2026-11-08T10:00:00Z' }
    ]);
    expect(brief?.length).toBeLessThan(31_000);
    expect(brief?.endsWith('[cut at 30000 characters]')).toBe(true);
  });
});

describe('acceptanceCriteria', () => {
  it('reads the checkbox lines, ticked or not, in order', () => {
    const issueText = [
      '## Goal',
      '',
      'Lists.',
      '',
      '## Acceptance criteria',
      '',
      '- [ ] You can make more lists. (33)',
      '* [x] A list shows its recipes newest first.',
      '  - [ ]   Extend the API test.  ',
      '- Not a criterion',
      '- [] Not one either'
    ].join('\n');
    expect(acceptanceCriteria(issueText)).toEqual([
      'You can make more lists. (33)',
      'A list shows its recipes newest first.',
      'Extend the API test.'
    ]);
  });

  it('is empty without a description', () => {
    expect(acceptanceCriteria(null)).toEqual([]);
  });
});

describe('design coverage', () => {
  const criteria = ['You can make lists.', 'Recipes can be removed from a list.', 'Leaving keeps your lists.'];
  const report = {
    stage: 'design',
    outcome: 'needs_input',
    summary: 'Design ready for review.',
    coverage: [
      { criterion: 1, board: 'New list' },
      { criterion: 3, why: 'No screen: it happens on leaving a household.' },
      { criterion: 0, board: 'Out of range' }
    ]
  };

  it('reads the valid entries and drops the rest', () => {
    expect(readDesignCoverage(report)).toEqual([
      { criterion: 1, board: 'New list', why: null },
      { criterion: 3, board: null, why: 'No screen: it happens on leaving a household.' }
    ]);
    expect(readDesignCoverage({ coverage: 'all of it' })).toEqual([]);
  });

  it('finds each criterion with neither a board nor a reason', () => {
    expect(uncoveredCriteria(criteria, report)).toEqual(['Recipes can be removed from a list.']);
    expect(uncoveredCriteria(criteria, { summary: 'No coverage reported.' })).toEqual(criteria);
    expect(uncoveredCriteria([], report)).toEqual([]);
  });

  const ready = {
    status: 'finished' as const,
    outcome: 'needs_input' as const,
    summary: 'Design ready for review.',
    report: report as never,
    usage: null,
    readings: [],
    stageMs: null
  };

  it('tells Design Review about an uncovered criterion', () => {
    expect(withDesignReviewNotes(ready, criteria).summary).toBe(
      'Design ready for review.\n\nNo board shows these acceptance criteria, and the design gave no reason:\n• Recipes can be removed from a list.'
    );
  });

  it('adds nothing when every criterion is covered, or to a hand-off', () => {
    expect(withDesignReviewNotes(ready, ['You can make lists.'])).toBe(ready);
    const handOff = { ...ready, outcome: 'done' as const };
    expect(withDesignReviewNotes(handOff, criteria)).toBe(handOff);
  });
});

describe('designDecisions', () => {
  it('settles each question by its answer, or by the suggestion drawn when approval came first', () => {
    expect(
      designDecisions([
        {
          prompt: 'Can a list change who it’s for?',
          options: ['No, chosen once', 'Yes, any time'],
          answer: 'Yes, any time'
        },
        { prompt: 'Who can delete a household list?', options: ['Any member', 'Only its maker'], answer: null }
      ])
    ).toEqual([
      { question: 'Can a list change who it’s for?', answer: 'Yes, any time' },
      { question: 'Who can delete a household list?', answer: 'Any member' }
    ]);
  });

  it('lets a later round’s answer to the same question win', () => {
    expect(
      designDecisions([
        { prompt: 'Who can delete a household list?', options: ['Any member', 'Only its maker'], answer: 'Any member' },
        {
          prompt: 'who can delete a household list? ',
          options: ['Any member', 'Only its maker'],
          answer: 'Only its maker'
        }
      ])
    ).toEqual([{ question: 'who can delete a household list?', answer: 'Only its maker' }]);
  });
});

describe('designIssueText', () => {
  it('keeps a description and drops an empty one', () => {
    expect(designIssueText('  ## Goal\n\nLists.  ')).toBe('## Goal\n\nLists.');
    expect(designIssueText('   ')).toBeNull();
    expect(designIssueText(null)).toBeNull();
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
