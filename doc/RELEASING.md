# Releasing

**A release is a tag.** Push `v0.7.0` and the pipeline builds it, tests it, publishes
the four npm packages and cuts a GitHub Release with the `.amxd` devices attached. There
is no `npm login` and no `pnpm release` from a laptop any more - and that is the point:
what ships is what CI built from a clean checkout, not what happened to be in someone's
working tree.

## The one-time set-up: TRUSTED PUBLISHING (no token)

Done once, by someone with admin on the repo and publish rights on the `@m4l-jweb` scope.

npm now requires 2FA to publish, which a plain token cannot satisfy in CI (it fails with
`EOTP`). The answer is **trusted publishing**: npm trusts THIS workflow to publish over
OIDC, so there is no token anywhere - nothing to leak, nothing to expire.

### 1. npmjs.org - trust the workflow, per package

For **each** of the four packages (`@m4l-jweb/bridge`, `build`, `surface`, `wrapper`):

1. Open the package page -> **Settings** -> **Trusted Publisher**.
2. Choose **GitHub Actions** and fill in:
   - **Organization or user**: `alienmind`
   - **Repository**: `m4l-jweb`
   - **Workflow filename**: `release.yml`
   - **Environment**: leave blank (the workflow uses none).
3. Save. Repeat for the other three packages.

A package must already exist on npm before it can be given a trusted publisher, which
these do (they were first published with a token). Once trusted publishing is on, the old
`NPM_TOKEN` secret is unused and can be deleted.

### 2. GitHub - nothing

There is no secret to add. `permissions: id-token: write` in the workflow is the whole
credential: pnpm (>= 10.12.1, pinned in `package.json`'s `packageManager`) exchanges the
GitHub OIDC token for a short-lived npm credential and generates **provenance**
automatically (visible as a "Provenance" badge on the package page).

## Cutting a release

1. **Bump the version in all five package.json files** - the root and the four packages.
   They ship together, always: `workspace:*` dependencies are rewritten to the real
   version at publish time, so a package left behind at 0.6.0 would be published as a
   0.7.0 that depends on a 0.7.0 that does not exist. **The workflow checks this and
   refuses to publish if they disagree** - before it publishes anything, not after it has
   published half of them.
2. Commit the bump, and update `CHANGELOG.md`.
3. Tag and push:

   ```bash
   git tag -a v0.7.0 -m "what is in it"
   git push origin main
   git push origin v0.7.0
   ```

4. Watch **Actions -> release**. It builds, tests, publishes, and cuts the Release.

## The one thing you cannot undo

**npm will not let you republish a version.** `0.7.0` can be published exactly once, ever
- unpublishing is restricted and does not free the number. So a wrong version number is
permanent, which is why the tag/manifest check runs *first* and why the packages are
published only after `pnpm build` and `pnpm test` have passed on the tag's own checkout.

If a release is broken, the fix is `0.7.1`. It is never `0.7.0` again.

## What CI runs on every push (`.github/workflows/ci.yml`)

The same thing you run locally, and the build is a real assertion, not a formality:
**`pnpm build` emits every `.amxd` with no Max installed.** A malformed patcher, a
duplicate box id, or a wrapper that is not ES5 fails there - in a pull request, rather
than in someone's Live set, where none of those three produce an error at all.
