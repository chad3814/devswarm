# NPM Trusted Publisher Configuration Verification

## Purpose
This document provides instructions for manually verifying that the NPM Trusted Publisher configuration matches the GitHub Actions workflow setup.

## Required Verification Steps

### 1. Access NPM Package Settings
1. Log into https://www.npmjs.com
2. Navigate to the `@devswarm/cli` package
3. Go to Settings → Publishing Access (or Trusted Publishers section)

### 2. Verify Trusted Publisher Configuration

Check that the following settings match exactly:

#### Repository Information
- **Repository Owner/Organization**: `chad3814`
- **Repository Name**: `devswarm`
- **Full Repository Path**: `chad3814/devswarm`

#### Workflow Configuration
- **Workflow Name**: `Publish to npm`
  - This MUST match the `name:` field at the top of `.github/workflows/npm-publish.yml`
  - Currently set to: `Publish to npm` (line 1 of the workflow file)

#### Branch Configuration
- **Allowed Branches**: Should allow both:
  - `main` (for dev releases with `-dev` suffix)
  - `release` (for stable releases)
- Alternatively, if wildcards are supported: `*` or `main,release`

#### Package Scope
- **Package Name**: `@devswarm/cli`
- Verify this matches `packages/cli/package.json` name field

### 3. Expected Configuration Screenshot

The trusted publisher configuration should show:
```
Repository: chad3814/devswarm
Workflow: Publish to npm
Branch: main (and/or release)
```

### 4. Common Issues

#### Workflow Name Mismatch
- If the workflow name in npm doesn't match the YAML file exactly, OIDC auth will fail
- The name is case-sensitive and must include all spaces/punctuation
- Current workflow name: "Publish to npm"

#### Branch Restrictions
- If only specific branches are allowed, both `main` and `release` must be listed
- Some configurations only allow one branch - verify both are permitted

#### Repository Path Issues
- Must be `chad3814/devswarm` (not just `devswarm`)
- GitHub username/org must match exactly

### 5. Testing the Configuration

After verifying the settings, the proof will be in testing:
1. Merge this fix to the main branch
2. Make a trivial change to `packages/cli/**` to trigger the workflow
3. Monitor GitHub Actions for the "Publish to npm" workflow
4. Check that it completes without `ENEEDAUTH` errors
5. Verify the package is published with provenance attestation

### 6. Provenance Verification

After successful publish, verify provenance on npm:
1. Go to the package page on npmjs.com
2. Look for a "Provenance" badge or section
3. Click to view attestation details
4. Should show:
   - Source repository: `chad3814/devswarm`
   - Workflow: `Publish to npm`
   - Commit SHA and build information

## Reference Links

- [NPM Trusted Publishing Documentation](https://docs.npmjs.com/generating-provenance-statements)
- [GitHub Actions OIDC Documentation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [setup-node Action Documentation](https://github.com/actions/setup-node#usage)

## Status

- [x] Document verification steps
- [ ] **MANUAL**: Access npm.com and verify configuration
- [ ] **MANUAL**: Confirm workflow name matches
- [ ] **MANUAL**: Confirm repository path matches
- [ ] **MANUAL**: Confirm branch configuration allows main and release
- [ ] **AUTOMATED**: Test will occur when workflow runs after merge

## Notes

This verification cannot be completed by an automated coordinator as it requires:
1. Access to npm.com with appropriate permissions
2. Human review of the Trusted Publisher configuration UI
3. Manual confirmation that all settings are correct

The actual test of whether the configuration is correct will occur when the GitHub Actions workflow runs after this fix is merged.
