# Deployment & Publishing

This document describes the automated deployment and publishing process for DevSwarm.

## NPM Publishing

The `@devswarm/cli` package is automatically published to npm via GitHub Actions.

### Publishing Strategy

**Development versions** (from `main` branch):
- Published with `dev` tag
- Version format: `{base}-dev.{timestamp}.{shortSHA}`
- Example: `0.1.0-dev.20250125221530.abc1234`
- Install with: `npm install -g @devswarm/cli@dev`

**Release versions** (from `release` branch):
- Published with `latest` tag
- Version format: `{base}` (from package.json)
- Example: `0.1.0`
- Install with: `npm install -g @devswarm/cli`

### Setup Requirements

#### npm Trusted Publishing

The package uses npm's Trusted Publishing feature, which authenticates via GitHub Actions OIDC tokens instead of long-lived NPM tokens. This provides better security and eliminates the need for manual token management.

**One-time Configuration (already completed):**

The `@devswarm/cli` package on npmjs.com is configured to trust GitHub Actions from this repository:
- Repository: `chad3814/devswarm`
- Workflow: `.github/workflows/npm-publish.yml`

**How it works:**
1. GitHub Actions generates an OIDC token with workflow/repository metadata
2. npm verifies this token against the trusted publisher configuration
3. If verification passes, publishing is allowed automatically
4. No `NPM_TOKEN` secret is required

**To configure for a new package:**
1. Log in to [npmjs.com](https://www.npmjs.com)
2. Navigate to package settings → "Publishing Access" → "Automation tokens"
3. Add GitHub Actions as trusted publisher:
   - Provider: GitHub Actions
   - Repository: `chad3814/devswarm`
   - Workflow: `.github/workflows/npm-publish.yml`
   - Environment: (leave empty)
4. Save configuration

### Workflow Behavior

The workflow triggers on pushes to `main` or `release` branches when:
- Files in `packages/cli/**` change
- Root `package.json` or `package-lock.json` changes
- The workflow file itself changes

**Build job:**
1. Checks out code
2. Installs dependencies
3. Builds all packages
4. Uploads CLI build artifacts

**Publish job:**
1. Downloads build artifacts
2. Determines version based on branch
3. Checks if version already exists on npm (skips if duplicate)
4. Publishes with appropriate tag and provenance
5. On release branch: auto-increments patch version and commits

### Supply Chain Security

All published packages include npm provenance attestation via Trusted Publishing:
- Verifies package was built by GitHub Actions from this specific repository
- Links package to specific commit, workflow, and workflow run
- Cryptographically proves authenticity without long-lived tokens
- Visible as "Provenance" badge on npm package page
- Automatic token rotation on each workflow run eliminates token leakage risks

### Version Management

**Development workflow:**
- Work on `main` branch
- Each push publishes a new dev version
- Users can test latest: `npm install -g @devswarm/cli@dev`

**Release workflow:**
1. Update version in `packages/cli/package.json` (e.g., `0.2.0`)
2. Merge to `release` branch
3. Workflow publishes `0.2.0` as latest
4. Workflow auto-bumps to `0.2.1-dev` for next cycle

### Manual Publishing

To publish manually (not recommended):

```bash
# Build first
npm run build

# Publish CLI package
cd packages/cli
npm publish --tag latest --access public
```

### Troubleshooting

**"403 Forbidden" when publishing**
- Trusted publisher not configured on npmjs.com
- Workflow path in npm config doesn't match actual workflow
- Verify configuration at: npmjs.com → Package Settings → Publishing Access → Automation tokens

**"Invalid token" or authentication errors**
- Ensure `id-token: write` permission is present in workflow (already configured)
- Workflow name must match exactly: `.github/workflows/npm-publish.yml`
- Repository must match: `chad3814/devswarm`

**"You cannot publish over the previously published versions"**
- Version already exists on npm (this is normal)
- Workflow handles this gracefully with version check
- Bump version in package.json if publishing manually

**"Package name too similar to existing package"**
- Scoped package name `@devswarm/cli` prevents conflicts
- Ensure `publishConfig.access: "public"` is set

**Workflow not triggering:**
- Check branch name is exactly `main` or `release`
- Verify file changes match path filters
- Check GitHub Actions is enabled for repository

**First publish of a new package:**
- Trusted Publishing requires the package to exist on npm first
- Initial publish may need to be done manually with `npm publish`
- After first publish, configure trusted publisher, then automation works

## Docker Image Publishing

(To be implemented - see GHCR publishing spec)

## Release Checklist

Before creating a release:

- [ ] All tests pass locally
- [ ] Version bumped in `packages/cli/package.json`
- [ ] CHANGELOG.md updated with version changes
- [ ] README.md reflects any CLI changes
- [ ] Merge PR to `release` branch
- [ ] Verify workflow completes successfully
- [ ] Test install: `npm install -g @devswarm/cli@latest`
- [ ] Verify binary works: `devswarm --version`
- [ ] Create GitHub release with tag
- [ ] Announce release in relevant channels

## Monitoring

Monitor published packages:
- npm package page: https://www.npmjs.com/package/@devswarm/cli
- GitHub Actions runs: Repository → Actions → "Publish to npm"
- Download stats: npm package page → "Versions" tab
