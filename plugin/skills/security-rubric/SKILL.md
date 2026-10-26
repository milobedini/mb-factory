---
name: security-rubric
description: What the factory's security check files and what it leaves alone — the bar for advisories and code findings, the categories, severities, verification and the finding fields the console files from. Preloaded into the security agent.
---

# Security rubric

Every finding becomes a Linear issue that a person has to read, accept or decline. File only what they would thank you for. A quiet day is a good result, not a failure to find something.

## What to file

**Advisories:** one finding per vulnerable package at its installed version, listing every advisory against it, because one version bump fixes them all (one ticket, one PR).

- `scope: "runtime"` when the package is in the production audit (`pnpm audit --prod`, the `--no-dev` export); otherwise `"dev"`.
- File runtime packages at `moderate` or worse, and dev-only packages at `high` or worse. The console drops anything below that bar.
- `severity` is the worst of the package's advisories. The fix is the lowest version that fixes all of them, and where to change it. If no fixed version exists, say so and suggest the mitigation from the advisory.

**Code**, in the range only: a concrete vulnerability, with the path and line, the way an attacker reaches it, and the fix. Categories (the fingerprint uses these names):

| Category | For example |
| --- | --- |
| `injection` | Raw SQL with string formatting, `extra()`/`raw()` with user input, shell commands built from input, `dangerouslySetInnerHTML` or `mark_safe` on user content |
| `authorisation` | A view or endpoint with `AllowAny` or no permission check that changes or reads someone else's data; object access without an ownership check |
| `authentication` | Login, session or token handling that can be bypassed, tokens in URLs or logs |
| `secrets` | A credential, key or token committed (even in tests or examples, if it looks real) |
| `settings` | `DEBUG` on outside development, `ALLOWED_HOSTS = ['*']`, `CORS_ALLOW_ALL_ORIGINS`, CSRF exemptions, security middleware removed, cookies without `Secure`/`HttpOnly` in production settings |
| `deserialisation` | `pickle`, `yaml.load` without a safe loader, `eval` on input |
| `ssrf` | Server-side requests to a URL the user controls |
| `path-traversal` | File paths built from input without normalising and confining them |
| `data-exposure` | A serializer or response that leaks fields it shouldn't (password hashes, emails, internal IDs) |
| `open-redirect` | Redirects to a URL from the request without an allow-list |
| `workflow` | GitHub Actions: `pull_request_target` checking out untrusted code, untrusted input (`github.event.*` titles, bodies, branch names) interpolated into `run:`, permissions broader than needed, third-party actions not pinned to a commit |
| `cryptography` | Home-made crypto, weak hashes for passwords, predictable tokens (`random` instead of `secrets`) |

## What not to file

- Style, naming, or "best practice" without an exploit: missing rate limiting on a read-only public endpoint, a missing security header on a static page, "consider using…".
- Hypotheticals: "if this were ever exposed…", "a future change could…".
- Anything in code the range didn't change or make reachable.
- Test fixtures and examples that are plainly fake (`password123` in a test factory).
- Advisories in packages the lockfile doesn't actually install, or that are already fixed at the installed version.
- Duplicates within the report: one finding per package, and one per category and file.

## Verify before reporting

For each code candidate, trace it from an entry point an attacker can reach (a URL, a form, an uploaded file, a webhook, a workflow trigger) to the vulnerable line, through the code as it is at `HEAD`. If the path is blocked (a permission class, a validator, the framework escaping it by default), drop it. If you can't decide, drop it and mention it in `summary`; don't file a maybe.

For each advisory, check the installed version against the affected range yourself; audit tools sometimes report a range the lockfile doesn't hit.

## Severity

- `critical`: exploitable remotely with no account, and leads to code execution, the database, or every user's data.
- `high`: exploitable with an ordinary account, or without one but limited in reach (one user's data, a stored XSS).
- `moderate`: needs unusual conditions, or the impact is small.
- `low`: worth fixing, hard to exploit.

Advisories keep the severity their advisory gives, unless the vulnerable function is plainly unused here; then say so in the evidence and lower it by one.

## The finding

| Field | |
| --- | --- |
| `fingerprint` | `advisory:<package>@<installed version>` (package name in lower case), or `code:<category>:<path>`. Stable: the same problem tomorrow gets the same fingerprint, so it isn't filed twice. |
| `kind` | `advisory` or `code` |
| `title` | One line for the Triage inbox, under 70 characters: what's wrong, not the category. |
| `severity` | `critical`, `high`, `moderate` or `low` |
| `scope` | Advisories only: `runtime` or `dev` |
| `evidence` | What you found and how it's reached: the advisory IDs and what they are, or the exploit path step by step. Plain Markdown; it is the issue's body. |
| `fix` | The change, specific enough for the implement stage: the file, the version or the code. |
| `size` | `XS`, `S`, `M`, `L` or `XL`, as triage sizes work. A version bump is usually `XS`. |
| `path`, `line` | Code findings: the file and the line where it happens. |

Write as you would for a colleague: plain, specific, British English, no alarm. The repo is public and the issues may be read by anyone in the workspace, so describe the problem and the fix, not a ready-made exploit.
