#!/usr/bin/env python3
"""Print `path:line  category  code` for every bypass marker a diff adds. Reads a unified diff on stdin.

Hits are candidates for the review to judge, never findings, so it always exits 0.
Covers TypeScript/JavaScript and Python. A TODO counts as ticketed when it names an issue ID such as TAS-123.
"""

import re
import sys

JS_FILE = re.compile(r'(?<!\.d)\.(ts|tsx|js|jsx|mjs|cjs)$')
PY_FILE = re.compile(r'\.py$')
GENERATED = re.compile(r'(^|/)(migrations/|schema\.d\.ts$|.*\.gen\.)')
TODO = ('todo', re.compile(r'\b(TODO|FIXME|HACK|XXX)\b(?!.*\b[A-Z][A-Z0-9]+-\d+)'))

JS_MARKERS = [
    ('suppression', re.compile(r'eslint-disable|@ts-(ignore|expect-error|nocheck)|biome-ignore')),
    ('test-dodge', re.compile(r'\b(it|test|describe)\.(only|skip)\s*\(|\b(xit|xdescribe|xtest)\s*\(')),
    ('type-escape', re.compile(r'\bas\s+any\b|\bas\s+unknown\s+as\b|:\s*any\b|<any>|[\w)\]]!(?=[.\[),;])')),
    ('error-swallow', re.compile(r'catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|undefined|null)\s*\)')),
    ('unsafe-html', re.compile(r'dangerouslySetInnerHTML|\.innerHTML\s*=')),
    ('tls-or-hook', re.compile(r'rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|--no-verify\b')),
    ('timer', re.compile(r'\bset(Timeout|Interval)\s*\(')),
    TODO,
    ('comment', re.compile(r'(^|\s)//|/\*')),
]
PY_MARKERS = [
    ('suppression', re.compile(r'#\s*(noqa|type:\s*ignore|pyright:\s*ignore|pragma:\s*no\s*cover)')),
    ('test-dodge', re.compile(r'pytest\.mark\.(skip|xfail)\b|\bpytest\.skip\(')),
    ('type-escape', re.compile(r'\bcast\(\s*Any\b|:\s*Any\b|->\s*Any\b')),
    ('error-swallow', re.compile(r'except(\s+\w+(\s+as\s+\w+)?)?\s*:\s*(pass|\.\.\.)\s*$|except\s*:')),
    ('unsafe-sql-or-exec', re.compile(r'\.raw\(|\.extra\(|\bcursor\.execute\(\s*f["\']|\b(eval|exec)\(|mark_safe\(|shell=True')),
    ('tls-or-hook', re.compile(r'verify\s*=\s*False|--no-verify\b')),
    ('timer', re.compile(r'\btime\.sleep\(')),
    TODO,
    ('comment', re.compile(r'^\s*#(?!!)|\s#\s')),
]
FILE_RE = re.compile(r'^\+\+\+ b/(.+)$')
HUNK_RE = re.compile(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@')


def markers_for(path):
    if GENERATED.search(path):
        return None
    if JS_FILE.search(path):
        return JS_MARKERS
    if PY_FILE.search(path):
        return PY_MARKERS
    return None


def main():
    path, markers, line_no, hits = None, None, 0, 0
    for raw in sys.stdin:
        line = raw.rstrip('\n')
        if line.startswith('+++ '):
            match = FILE_RE.match(line)
            path = match.group(1) if match else None
            markers = markers_for(path) if path else None
            continue
        match = HUNK_RE.match(line)
        if match:
            line_no = int(match.group(1))
            continue
        if markers is None or line.startswith(('-', '\\')):
            continue
        if line.startswith('+'):
            content = line[1:]
            category = next((name for name, pattern in markers if pattern.search(content)), None)
            if category:
                print(f'{path}:{line_no}\t{category}\t{content.strip()[:160]}')
                hits += 1
        line_no += 1
    print(f'scan: {hits} candidate(s)', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
