# Releasing

**A release is a tag.** Push `v0.7.0` and the pipeline builds it, tests it, publishes
the four npm packages and cuts a GitHub Release with the `.amxd` devices attached. There
is no `npm login` and no `pnpm release` from a laptop any more - and that is the point:
what ships is what CI built from a clean checkout, not what happened to be in someone's
working tree.

## The one-time set-up

Both halves have to be done once, by someone with admin on the repo and publish rights on
the `@m4l-jweb` npm scope.

### 1. npmjs.org - a token CI can publish with

1. Log in as the account that owns the **`@m4l-jweb`** scope.
2. **Avatar -> Access Tokens -> Generate New Token -> Granular Access Token**
   (the classic "Automation" token also works; granular is narrower and preferred).
3. Give it:
   - **Expiration**: your call. A token that expires is a release that fails loudly one
     day, which is better than a token that leaks quietly forever.
   - **Packages and scopes**: **Read and write**, limited to the **`@m4l-jweb`** scope.
   - **Organizations**: no access needed.
4. Copy the token. npm shows it **once**.

### 2. GitHub - give CI the token

**Settings -> Secrets and variables -> Actions -> New repository secret**

- **Name**: `NPM_TOKEN` (exactly - `.github/workflows/release.yml` reads this name)
- **Secret**: the token from step 1

Nothing else. `permissions:` in the workflow already grants what it needs to create the
Release and to attach npm **provenance** (npm records which workflow, from which commit,
published each version - visible as a "Provenance" badge on the package page).

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
