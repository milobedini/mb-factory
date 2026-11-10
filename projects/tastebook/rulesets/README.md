# Tastebook's rulesets on `main`

They replace the classic branch protection (docs/express.md, "Who merges"), so the factory's App can land an express
PR without an approval but never without green checks. PRs land through GitHub's merge queue (docs/merge-queue.md).

- **Checks** (`checks.json`, ID 26517093): the five required checks (CI's jobs), resolved conversations, no force push
  or deletion, and the merge queue: merge commits, only PRs whose checks pass (`ALLGREEN`), up to 5 groups built and
  merged at once with no wait, a 30-minute check timeout. The checks aren't strict: the queue tests each PR on top of
  `main` and the PRs ahead of it instead. No bypass for anyone.
- **Review** (`review.json`, ID 26517145): one approving review, dismissed on a new push. `mb-factory-bot` (App
  5483828) is exempt, which lets it add its own PRs to the queue (a bypass of `always` doesn't: the trial in
  docs/merge-queue.md); the repository's admins may bypass it.

A person applies them, since auto mode blocks Claude from changing protection:

```sh
gh api -X PUT repos/Milo-Bedini/tastebook/rulesets/26517093 --input projects/tastebook/rulesets/checks.json
gh api -X PUT repos/Milo-Bedini/tastebook/rulesets/26517145 --input projects/tastebook/rulesets/review.json
```

`require_extra_approval_for_unattributed_changes` is set to `false`: GitHub turns it on by default, it isn't
documented yet, and on Checks, which nobody bypasses, it could hold the factory's merge. The branch protection these
replace had nothing like it.
