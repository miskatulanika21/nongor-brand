## What & why

<!-- One paragraph: what changes, and what problem it solves. Link the issue if there is one. -->

## How it was verified

<!-- Tick what you actually ran; delete what does not apply. Don't tick from memory. -->

- [ ] `bun run check` passes locally (typecheck + lint + format + unit tests + build)
- [ ] Exercised in a real browser (not curl/fetch — the parser matters for CSP hashes)
- [ ] E2E / a11y specs run, or explicitly not applicable

## Risk checklist

- [ ] **No secrets, credentials, or `.env` values** added to tracked files
- [ ] Migrations (if any) are **forward-only**, versions strictly increasing, and
      `bun run check:migrations` is green — the repo history must match production
- [ ] Any new `.rpc()` call targets the `api` schema explicitly
- [ ] Server-only code is not imported at module scope from a `.api.ts` file
      (only inside handler closures)
- [ ] Status docs updated if this closes a stage/pass (`CURRENT_STATUS.md`,
      `IMPLEMENTATION_PLAN.md`, `docs/stage-7-launch-cutover.md`)

## Rollback

<!-- How to undo this if it misbehaves in production. "Revert the commit" is a valid
     answer only when there is no migration or config change involved. -->
