# Tastebook's rulesets on `main`

They replace the classic branch protection (docs/express.md, "Who merges"), so the factory's App can merge an express
PR without an approval but never without green checks.

- **Checks** (`checks.json`): the five required checks (CI's jobs) on an up-to-date branch, resolved conversations, no force push
  or deletion. No bypass for anyone.
- **Review** (`review.json`): one approving review, dismissed on a new push. `mb-factory-bot` (App 5483828) and the
  repository's admins may bypass it.

A person applies them, since auto mode blocks Claude from changing protection:

```sh
gh api -X POST repos/milobedini/tastebook/rulesets --input projects/tastebook/rulesets/checks.json
gh api -X POST repos/milobedini/tastebook/rulesets --input projects/tastebook/rulesets/review.json
gh api -X DELETE repos/milobedini/tastebook/branches/main/protection
```

To change one later, `PUT repos/milobedini/tastebook/rulesets/<id>` with the edited file (Checks is 26517093).

`require_extra_approval_for_unattributed_changes` is set to `false`: GitHub turns it on by default, it isn't
documented yet, and on Checks, which nobody bypasses, it could hold the factory's merge. The branch protection these
replace had nothing like it.
