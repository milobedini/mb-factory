import { describe, expect, it } from 'vitest';

import type { Finding } from './jobs';
import {
  coveredHead,
  decideFiling,
  findingIssue,
  groupFindings,
  groupIssue,
  isWorthFiling,
  jobCheckText,
  jobLabels,
  jobTitle,
  latestSlot,
  neutraliseMarkdown,
  nextSlot,
  readJobReport,
  slotDay
} from './jobs';

const job = { at: '06:00' };
const london = 'Europe/London';

describe('jobTitle', () => {
  it('names the cadence and what the job reads', () => {
    expect(jobTitle({ agent: 'security', scope: 'changes' })).toBe('Daily security check');
    expect(jobTitle({ agent: 'docs', day: 'monday', scope: 'repo' })).toBe('Weekly docs pass over the whole repo');
  });
});

describe('latestSlot and nextSlot', () => {
  it('reads the slot in the project time zone, in winter and in summer', () => {
    // GMT: 06:00 London is 06:00 UTC.
    expect(latestSlot(job, new Date('2026-10-27T09:00:00Z'), london)).toEqual(new Date('2026-10-27T06:00:00Z'));
    // BST: 06:00 London is 05:00 UTC.
    expect(latestSlot(job, new Date('2026-07-01T09:00:00Z'), london)).toEqual(new Date('2026-07-01T05:00:00Z'));
  });

  it("falls back to yesterday's slot before today's has come", () => {
    expect(latestSlot(job, new Date('2026-10-27T05:59:00Z'), london)).toEqual(new Date('2026-10-26T06:00:00Z'));
  });

  it('counts a slot that is exactly now as due, and the next one as tomorrow', () => {
    const now = new Date('2026-10-27T06:00:00Z');
    expect(latestSlot(job, now, london)).toEqual(now);
    expect(nextSlot(job, now, london)).toEqual(new Date('2026-10-28T06:00:00Z'));
  });

  it('finds a weekly job’s slot on its day, across a change of clocks', () => {
    const weekly = { at: '05:00', day: 'monday' as const };
    // Mon 26 Oct 2026 is the first Monday in GMT; the Monday before was in BST.
    expect(latestSlot(weekly, new Date('2026-10-27T09:00:00Z'), london)).toEqual(new Date('2026-10-26T05:00:00Z'));
    expect(nextSlot(weekly, new Date('2026-10-27T09:00:00Z'), london)).toEqual(new Date('2026-11-02T05:00:00Z'));
    expect(latestSlot(weekly, new Date('2026-10-26T04:59:00Z'), london)).toEqual(new Date('2026-10-19T04:00:00Z'));
    expect(nextSlot(weekly, new Date('2026-10-26T04:59:00Z'), london)).toEqual(new Date('2026-10-26T05:00:00Z'));
    const now = new Date('2026-10-26T05:00:00Z');
    expect(latestSlot(weekly, now, london)).toEqual(now);
    expect(nextSlot(weekly, now, london)).toEqual(new Date('2026-11-02T05:00:00Z'));
  });

  it('crosses a change of clocks', () => {
    // The clocks went back at 02:00 BST on 25 Oct 2026: Saturday's slot was 05:00 UTC, Sunday's 06:00 UTC.
    expect(nextSlot(job, new Date('2026-10-24T12:00:00Z'), london)).toEqual(new Date('2026-10-25T06:00:00Z'));
    expect(latestSlot(job, new Date('2026-10-25T05:30:00Z'), london)).toEqual(new Date('2026-10-24T05:00:00Z'));
  });

  it('works across a month and a year end, and in UTC', () => {
    expect(nextSlot({ at: '23:30' }, new Date('2026-12-31T23:45:00Z'), 'UTC')).toEqual(
      new Date('2027-01-01T23:30:00Z')
    );
  });
});

const advisory = {
  fingerprint: 'advisory:GHSA-abcd-1234-wxyz:django',
  kind: 'advisory',
  title: 'Django 6.1.0 has a SQL injection in JSONField lookups',
  severity: 'high',
  scope: 'runtime',
  evidence: 'pip-audit reports GHSA-abcd-1234-wxyz for django 6.1.0, fixed in 6.1.1.',
  fix: 'Bump django to 6.1.1 in backend/pyproject.toml and re-lock.',
  size: 'XS'
};

const codeFinding = {
  fingerprint: 'code:missing-authorisation:backend/recipes/views.py',
  kind: 'code',
  title: 'Anyone can delete a recipe',
  severity: 'critical',
  evidence: 'RecipeViewSet allows DELETE with AllowAny.',
  fix: 'Require IsAuthenticated and check ownership.',
  path: 'backend/recipes/views.py',
  line: 42,
  size: 'S'
};

const docsFinding = {
  fingerprint: 'docs:README.md:backend-test-command',
  kind: 'docs',
  title: 'README still says to run the backend tests with manage.py test',
  severity: 'moderate',
  evidence: 'TAS-30 moved the backend tests to pytest; README.md line 31 still says `uv run manage.py test`.',
  fix: 'Change the command in README.md to `uv run pytest` from `backend/`.',
  path: 'README.md',
  line: 31,
  size: 'XS'
};

describe('readJobReport', () => {
  it("keeps only the kinds the job reports: another job's findings are dropped", () => {
    const docs = readJobReport({ findings: [docsFinding, codeFinding] }, 'docs');
    expect(docs.findings.map(({ kind }) => kind)).toEqual(['docs']);
    expect(docs.dropped).toBe(1);
    const security = readJobReport({ findings: [docsFinding, codeFinding] }, 'security');
    expect(security.findings.map(({ kind }) => kind)).toEqual(['code']);
  });

  it('reads the head, the commits and each well-formed finding', () => {
    const head = 'a'.repeat(40);
    const report = readJobReport(
      { stage: 'security', head, commits: 3, findings: [advisory, codeFinding] },
      'security'
    );
    expect(report).toMatchObject({ head, commits: 3, gaps: [], dropped: 0 });
    expect(report.findings.map(({ fingerprint }) => fingerprint)).toEqual([
      advisory.fingerprint,
      codeFinding.fingerprint
    ]);
  });

  it('drops malformed, repeated and below-the-bar findings, and counts them', () => {
    const report = readJobReport(
      {
        findings: [
          advisory,
          advisory,
          { ...advisory, fingerprint: 'nonsense' },
          { ...advisory, fingerprint: 'code:x:y' },
          { ...advisory, fingerprint: 'advisory:GHSA-2:vite', severity: 'moderate', scope: 'dev' },
          'not an object'
        ]
      },
      'security'
    );
    expect(report.findings).toHaveLength(1);
    expect(report.dropped).toBe(5);
  });

  it('ignores a head that is not a full SHA, and a path that climbs out', () => {
    const report = readJobReport({ head: 'main', findings: [{ ...codeFinding, path: '../etc/passwd' }] }, 'security');
    expect(report.head).toBeNull();
    expect(report.findings[0]?.path).toBeNull();
  });

  it('reads a report with nothing in it', () => {
    expect(readJobReport(null, 'security')).toEqual({ head: null, commits: null, gaps: [], findings: [], dropped: 0 });
  });

  it('reads what the job could not check, one line each', () => {
    expect(readJobReport({ gaps: ['pip-audit could not\nreach PyPI', '', 7] }, 'security').gaps).toEqual([
      'pip-audit could not reach PyPI'
    ]);
  });
});

describe('isWorthFiling', () => {
  const finding = (fields: Partial<Finding>): Finding => ({ ...(advisory as Finding), ...fields });

  it('files advisories from moderate up in what ships, and from high up in what only builds', () => {
    expect(isWorthFiling(finding({ severity: 'moderate', scope: 'runtime' }))).toBe(true);
    expect(isWorthFiling(finding({ severity: 'low', scope: 'runtime' }))).toBe(false);
    expect(isWorthFiling(finding({ severity: 'high', scope: 'dev' }))).toBe(true);
    expect(isWorthFiling(finding({ severity: 'moderate', scope: 'dev' }))).toBe(false);
  });

  it('treats an advisory with no scope as shipping', () => {
    expect(isWorthFiling(finding({ severity: 'moderate', scope: null }))).toBe(true);
  });

  it('files a concrete code issue at any severity', () => {
    expect(isWorthFiling(finding({ kind: 'code', severity: 'low' }))).toBe(true);
  });
});

describe('coveredHead', () => {
  const filed = new Set(['code:xss:a', 'docs:README.md:setup']);

  it('starts after the newest run when everything it found was filed', () => {
    expect(
      coveredHead(
        [
          { head: 'c3', fingerprints: ['code:xss:a'] },
          { head: 'c2', fingerprints: [] }
        ],
        filed
      )
    ).toBe('c3');
  });

  it('holds back to the newest run whose findings all reached Linear', () => {
    expect(
      coveredHead(
        [
          { head: 'c3', fingerprints: ['code:xss:a', 'code:csrf:b'] },
          { head: 'c2', fingerprints: ['docs:README.md:setup'] },
          { head: 'c1', fingerprints: [] }
        ],
        filed
      )
    ).toBe('c2');
  });

  // The docs check, 28 Oct: 27 Oct's finding was refused and today's was filed, so the next check would have started
  // after today's and never found 27 Oct's again.
  it('holds back past an older refused run even when a newer one filed everything', () => {
    expect(
      coveredHead(
        [
          { head: 'c3', fingerprints: ['docs:README.md:setup'] },
          { head: 'c2', fingerprints: ['docs:docs/architecture.md:styling-planned'] },
          { head: 'c1', fingerprints: [] }
        ],
        filed
      )
    ).toBe('c1');
  });

  it('moves on from the oldest run given when none of them filed everything', () => {
    expect(
      coveredHead(
        [
          { head: 'c3', fingerprints: ['code:csrf:b'] },
          { head: 'c2', fingerprints: ['code:sqli:c'] }
        ],
        filed
      )
    ).toBe('c2');
  });

  it('has no head before the first run', () => {
    expect(coveredHead([], filed)).toBeUndefined();
  });
});

describe('decideFiling', () => {
  const previous = { identifier: 'TAS-20', url: 'https://linear.app/tastebook/issue/TAS-20' };

  it('files what was never filed', () => {
    expect(decideFiling(undefined)).toEqual({ kind: 'file' });
  });

  it('leaves an open or declined issue alone', () => {
    expect(decideFiling({ ...previous, stateType: 'triage' })).toMatchObject({ kind: 'known', why: 'open' });
    expect(decideFiling({ ...previous, stateType: 'started' })).toMatchObject({ kind: 'known', why: 'open' });
    expect(decideFiling({ ...previous, stateType: 'canceled' })).toMatchObject({ kind: 'known', why: 'declined' });
  });

  it('counts an issue it cannot read as open', () => {
    expect(decideFiling({ ...previous, stateType: null })).toMatchObject({ kind: 'known', why: 'open' });
  });

  it('files again what came back after its issue was done', () => {
    expect(decideFiling({ ...previous, stateType: 'completed' })).toMatchObject({ kind: 'refile' });
  });
});

describe('findingIssue', () => {
  const context = {
    jobTitle: 'Daily security check',
    repository: 'milobedini/tastebook',
    head: 'b'.repeat(40),
    runUrl: 'https://github.com/milobedini/tastebook/actions/runs/1',
    day: 'Tue 27 Oct'
  };
  const [finding] = readJobReport({ findings: [codeFinding] }, 'security').findings;

  it('shapes the issue for triage: title, priority and estimate from the finding', () => {
    if (!finding) {
      throw new Error('expected a finding');
    }
    const issue = findingIssue(finding, context);
    expect(issue.title).toBe('Security: Anyone can delete a recipe');
    expect(issue.priority).toBe(1);
    expect(issue.estimate).toBe(2);
    expect(issue.description).toContain(
      `[\`backend/recipes/views.py:42\`](https://github.com/milobedini/tastebook/blob/${'b'.repeat(40)}/backend/recipes/views.py#L42)`
    );
    expect(issue.description).toContain('Found by the daily security check on Tue 27 Oct ([run log](');
    expect(issue.description).toContain('Fingerprint: `code:missing-authorisation:backend/recipes/views.py`');
  });

  it('links the issue a finding came back after', () => {
    if (!finding) {
      throw new Error('expected a finding');
    }
    const previous = { identifier: 'TAS-20', url: 'https://linear.app/x/TAS-20', stateType: 'completed' };
    expect(findingIssue(finding, { ...context, previous }).description).toContain(
      'It came back after [TAS-20](https://linear.app/x/TAS-20) was done.'
    );
  });

  it('names a docs finding as docs drift', () => {
    const [docs] = readJobReport({ findings: [docsFinding] }, 'docs').findings;
    if (!docs) {
      throw new Error('expected a finding');
    }
    const issue = findingIssue(docs, { ...context, jobTitle: jobTitle({ agent: 'docs', scope: 'changes' }) });
    expect(issue.title).toBe('Docs: README still says to run the backend tests with manage.py test');
    expect(issue.priority).toBe(3);
    expect(issue.description).toContain('**Kind:** docs drift');
    expect(issue.description).toContain('Found by the daily docs check on Tue 27 Oct');
  });

  it('clips a long title and leaves the estimate unset without a size', () => {
    const [long] = readJobReport(
      { findings: [{ ...advisory, title: 'x'.repeat(150), size: undefined }] },
      'security'
    ).findings;
    if (!long) {
      throw new Error('expected a finding');
    }
    const issue = findingIssue(long, context);
    expect(issue.title).toHaveLength(80);
    expect(issue.estimate).toBeNull();
  });
});

describe('groupFindings and groupIssue', () => {
  const context = {
    jobTitle: 'Daily security check',
    repository: 'milobedini/tastebook',
    head: 'b'.repeat(40),
    runUrl: null,
    day: 'Tue 27 Oct'
  };
  const lhci = 'Update @lhci/cli in frontend';
  const findings = readJobReport(
    {
      findings: [
        { ...advisory, fingerprint: 'advisory:tmp@0.0.33', title: 'tmp has a path traversal', group: lhci },
        codeFinding,
        {
          ...advisory,
          fingerprint: 'advisory:basic-ftp@5.3.1',
          title: 'basic-ftp has a slow parser',
          severity: 'moderate',
          size: 'S',
          group: `  ${lhci}  `
        }
      ]
    },
    'security'
  ).findings;
  const items = findings.map((finding) => ({ finding }));

  it('reads a group and puts findings with the same one together, in the order they came', () => {
    expect(findings.map(({ group }) => group ?? null)).toEqual([lhci, null, lhci]);
    expect(groupFindings(items).map((group) => group.map(({ finding }) => finding.fingerprint))).toEqual([
      ['advisory:tmp@0.0.33', 'advisory:basic-ftp@5.3.1'],
      ['code:missing-authorisation:backend/recipes/views.py']
    ]);
  });

  it('files a group as one issue at its worst severity and largest size', () => {
    const [group] = groupFindings(items);
    if (!group) {
      throw new Error('expected a group');
    }
    const issue = groupIssue([...group].reverse(), context);
    expect(issue.title).toBe('Security: Update @lhci/cli in frontend (2 advisories)');
    expect(issue.priority).toBe(2);
    expect(issue.estimate).toBe(2);
    expect(issue.description).toContain('**Severity:** High, the worst of 2. One change fixes them all:');
    expect(issue.description).toContain('## tmp has a path traversal');
    expect(issue.description).toContain('## basic-ftp has a slow parser');
    expect(issue.description).toContain('Fingerprints: `advisory:basic-ftp@5.3.1`, `advisory:tmp@0.0.33`');
  });

  it('files a group of one as the finding itself', () => {
    const [, single] = groupFindings(items);
    const [first] = single ?? [];
    if (!first) {
      throw new Error('expected a finding');
    }
    expect(groupIssue([first], context)).toEqual(findingIssue(first.finding, context));
  });
});

describe('neutraliseMarkdown', () => {
  it('escapes every form of link, image and HTML', () => {
    expect(
      neutraliseMarkdown(
        'See ![pixel](https://evil.example/p.png), [the [nested] docs](https://evil.example/login), ![ref][1], <img src="https://x/y"> and <https://evil.example>.\n\n[1]: https://evil.example/q.png'
      )
    ).toBe(
      'See !\\[pixel\\](https://evil.example/p.png), \\[the \\[nested\\] docs\\](https://evil.example/login), !\\[ref\\]\\[1\\], \\<img src="https://x/y"\\> and \\<https://evil.example\\>.\n\n\\[1\\]: https://evil.example/q.png'
    );
  });

  it('escapes backslashes first, so an escape in the text cannot undo one', () => {
    expect(neutraliseMarkdown('\\[x](y)')).toBe('\\\\\\[x\\](y)');
  });

  it('leaves text without brackets alone', () => {
    expect(neutraliseMarkdown('Use parameters in views.py:42 (see https://docs.djangoproject.com).')).toBe(
      'Use parameters in views.py:42 (see https://docs.djangoproject.com).'
    );
  });
});

describe('jobCheckText', () => {
  const runUrl = 'https://github.com/milobedini/tastebook/actions/runs/1';

  it('says a clean day was clean', () => {
    expect(jobCheckText('Daily security check', 'Tue 27 Oct', { kind: 'clean', commits: 3, gaps: [] }, runUrl)).toBe(
      `*Daily security check, Tue 27 Oct:* clean. Reviewed 3 commits on main. Nothing new to file. <${runUrl}|Run log>`
    );
  });

  it('lists what it filed and what was already filed', () => {
    const text = jobCheckText(
      'Daily security check',
      'Tue 27 Oct',
      {
        kind: 'filed',
        commits: 1,
        gaps: [],
        filed: [{ identifier: 'TAS-21', url: 'https://l/TAS-21', title: 'Security: <script> in titles' }],
        known: [{ identifier: 'TAS-20', url: 'https://l/TAS-20' }],
        unfiled: ['Session cookie & CSRF token readable']
      },
      runUrl
    );
    expect(text.split('\n')).toEqual([
      `*Daily security check, Tue 27 Oct:* filed 1 issue in Triage. Reviewed 1 commit on main. <${runUrl}|Run log>`,
      '• <https://l/TAS-21|TAS-21> Security: &lt;script&gt; in titles',
      'Already filed: <https://l/TAS-20|TAS-20>.',
      'Also couldn’t file 1 finding in Linear:',
      '• Session cookie &amp; CSRF token readable',
      'Linear’s reason is in the next health message. The next check looks at the same commits again.'
    ]);
  });

  it('leads with what it couldn’t file when Linear refused everything', () => {
    const text = jobCheckText(
      'Daily docs check',
      'Tue 27 Oct',
      {
        kind: 'filed',
        commits: 82,
        gaps: [],
        filed: [],
        known: [],
        unfiled: ['README names the old domain', 'Stale setup steps']
      },
      null
    );
    expect(text.split('\n')).toEqual([
      '*Daily docs check, Tue 27 Oct:* couldn’t file 2 findings in Linear. Reviewed 82 commits on main.',
      '• README names the old domain',
      '• Stale setup steps',
      'Linear’s reason is in the next health message. The next check looks at the same commits again.'
    ]);
  });

  it('says when everything it found was already filed', () => {
    const text = jobCheckText(
      'Daily security check',
      'Tue 27 Oct',
      {
        kind: 'filed',
        commits: null,
        gaps: [],
        filed: [],
        known: [{ identifier: 'TAS-20', url: 'https://l/TAS-20' }],
        unfiled: []
      },
      null
    );
    expect(text).toBe(
      '*Daily security check, Tue 27 Oct:* nothing new to file.\nAlready filed: <https://l/TAS-20|TAS-20>.'
    );
  });

  it('does not call a day clean when something went unchecked', () => {
    expect(
      jobCheckText(
        'Daily security check',
        'Tue 27 Oct',
        { kind: 'clean', commits: 0, gaps: ['pnpm audit failed'] },
        null
      )
    ).toBe(
      '*Daily security check, Tue 27 Oct:* nothing to file, but not everything was checked. Reviewed 0 commits on main.\nNot checked: pnpm audit failed.'
    );
  });

  it('says it failed, with why', () => {
    expect(jobCheckText('Daily security check', 'Tue 27 Oct', { kind: 'failed', summary: 'No report.' }, runUrl)).toBe(
      `*Daily security check, Tue 27 Oct:* failed. No report. <${runUrl}|Run log>`
    );
  });
});

describe('slotDay', () => {
  it('names the day in the project time zone', () => {
    expect(slotDay(new Date('2026-10-27T06:00:00Z'), london)).toBe('Tue 27 Oct');
  });
});

describe('jobLabels', () => {
  it('labels each job’s issues with what found them', () => {
    expect(jobLabels('security')).toEqual(['security', 'factory']);
    expect(jobLabels('docs')).toEqual(['docs', 'factory']);
  });
});
