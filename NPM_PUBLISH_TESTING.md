# NPM Publishing Workflow Testing Plan

## Purpose
This document outlines the testing plan for the NPM Trusted Publishing OIDC authentication fix.

## Prerequisites
- Task Group 1 (Add NODE_AUTH_TOKEN) must be complete ✅
- Task Group 2 (Verify NPM config) should be verified ✅
- Changes must be merged to main branch

## Test Scenarios

### Test 1: Dev Release (Main Branch)
**Objective**: Verify OIDC authentication works for dev releases

**Steps**:
1. Ensure changes are merged to `main` branch
2. Make a trivial change to trigger the workflow:
   ```bash
   # Example: Add a comment or update version in package.json
   git checkout main
   git pull
   # Make a small change to packages/cli/src/index.ts or similar
   git add .
   git commit -m "test: trigger npm publish workflow"
   git push origin main
   ```
3. Monitor GitHub Actions at: https://github.com/chad3814/devswarm/actions
4. Open the "Publish to npm" workflow run

**Expected Results**:
- ✅ Workflow starts automatically on push to main
- ✅ Build step completes successfully
- ✅ Publish step authenticates WITHOUT `ENEEDAUTH` error
- ✅ Package publishes with dev tag and timestamped version
  - Format: `{version}-dev.{timestamp}.{sha}`
  - Example: `1.0.0-dev.20260126181530.abc1234`
- ✅ No errors related to authentication
- ✅ Workflow completes with success status

**Verification**:
1. Check npmjs.com for the newly published version
2. Verify the version has `-dev` suffix
3. Check for provenance badge on package page
4. Click provenance to see attestation details

### Test 2: Release (Release Branch)
**Objective**: Verify OIDC authentication works for stable releases

**Steps**:
1. Ensure changes are merged to `release` branch
2. Make a change to trigger the workflow:
   ```bash
   git checkout release
   git pull
   # Make a small change to packages/cli/src/index.ts or similar
   git add .
   git commit -m "test: trigger npm publish workflow for release"
   git push origin release
   ```
3. Monitor GitHub Actions

**Expected Results**:
- ✅ Workflow starts automatically on push to release
- ✅ Build step completes successfully
- ✅ Publish step authenticates WITHOUT `ENEEDAUTH` error
- ✅ Package publishes with `latest` tag and clean version
  - Format: `{version}` (no suffix)
  - Example: `1.0.0`
- ✅ After publish, version is auto-bumped (patch increment)
- ✅ Version bump is committed back to release branch

**Verification**:
1. Check npmjs.com for the newly published version
2. Verify it's tagged as `latest`
3. Verify no `-dev` suffix
4. Check for provenance badge
5. Verify release branch shows version bump commit

### Test 3: Provenance Verification
**Objective**: Verify published packages have valid provenance attestation

**Steps**:
1. Go to https://www.npmjs.com/package/@devswarm/cli
2. Click on the version you just published
3. Look for "Provenance" section or badge

**Expected Results**:
- ✅ Provenance badge is visible
- ✅ Clicking shows attestation details:
  - Source repository: `chad3814/devswarm`
  - Workflow: `Publish to npm`
  - Commit SHA matches the git commit
  - Build timestamp is recent
- ✅ Attestation is cryptographically signed
- ✅ Can verify authenticity via npm CLI:
  ```bash
  npm view @devswarm/cli@{version} --json | jq .dist.attestations
  ```

### Test 4: Negative Test - Verify Old Behavior is Fixed
**Objective**: Confirm the ENEEDAUTH error no longer occurs

**Steps**:
1. Review logs from the successful workflow run
2. Search for authentication-related log output

**Expected Results**:
- ✅ No `ENEEDAUTH` errors in logs
- ✅ No `npm error need auth` messages
- ✅ No suggestions to run `npm adduser`
- ✅ Publish step shows successful authentication
- ✅ Logs may show OIDC token exchange (depending on verbosity)

## Success Criteria

All tests must pass for the fix to be considered complete:
- [x] Task Group 1: NODE_AUTH_TOKEN added to workflow
- [x] Task Group 2: NPM config documented for verification
- [ ] **PENDING**: Test 1 - Dev release publishes successfully
- [ ] **PENDING**: Test 2 - Release publishes successfully
- [ ] **PENDING**: Test 3 - Provenance is valid
- [ ] **PENDING**: Test 4 - No ENEEDAUTH errors

## Troubleshooting

### If Authentication Still Fails

1. **Check NPM Trusted Publisher Config**:
   - Verify workflow name matches exactly: "Publish to npm"
   - Verify repository: "chad3814/devswarm"
   - Verify branch is allowed (main or release)

2. **Check GitHub Actions Permissions**:
   - Verify workflow has `id-token: write` (line 16)
   - Verify `setup-node` has `registry-url` (lines 29, 57)

3. **Check Environment Variable**:
   - Verify `NODE_AUTH_TOKEN` is set in publish step (line 107-108)
   - Value should be `${{ secrets.GITHUB_TOKEN }}`

4. **Enable Debug Logging**:
   - Re-run workflow with debug logging enabled
   - Look for OIDC token exchange messages

### If Provenance is Missing

1. **Check --provenance Flag**:
   - Verify `npm publish` has `--provenance` flag (line 109)

2. **Check npm Version**:
   - Provenance requires npm 9.5.0 or later
   - Workflow uses Node 22 which includes npm 10.x ✅

3. **Check OIDC Permissions**:
   - Provenance requires `id-token: write` (line 16) ✅

## Rollback Plan

If the fix doesn't work:
1. The workflow will fail at publish step (no changes will be published)
2. Review logs to identify the issue
3. Make corrections and push again
4. No rollback needed as failed publishes don't affect npm registry

## Timeline

- **Immediate**: Workflow will trigger on next push to main with CLI changes
- **Duration**: Each workflow run takes ~2-5 minutes
- **Frequency**: Can test multiple times if needed

## Post-Testing Actions

After successful testing:
1. Document test results in this file
2. Update spec status to complete
3. Close related issues/tickets
4. Announce successful NPM Trusted Publishing setup

## References

- Workflow file: `.github/workflows/npm-publish.yml`
- NPM package: https://www.npmjs.com/package/@devswarm/cli
- GitHub Actions: https://github.com/chad3814/devswarm/actions
