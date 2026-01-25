# Deployment & Publishing

This document describes the automated deployment and publishing process for Orchestr8.

## NPM Publishing

The `@orchestr8/cli` package is automatically published to npm via GitHub Actions.

### Publishing Strategy

**Development versions** (from `main` branch):
- Published with `dev` tag
- Version format: `{base}-dev.{timestamp}.{shortSHA}`
- Example: `0.1.0-dev.20250125221530.abc1234`
- Install with: `npm install -g @orchestr8/cli@dev`

**Release versions** (from `release` branch):
- Published with `latest` tag
- Version format: `{base}` (from package.json)
- Example: `0.1.0`
- Install with: `npm install -g @orchestr8/cli`

### Setup Requirements

#### NPM Token

A valid NPM access token is required for publishing. The token must:
- Have publish permissions for the `@orchestr8` scope
- Be stored as `NPM_TOKEN` in GitHub repository secrets

**Creating the NPM token:**
1. Log in to [npmjs.com](https://www.npmjs.com)
2. Click your profile icon → "Access Tokens"
3. Click "Generate New Token" → "Classic Token"
4. Select "Automation" type (or "Publish" if available)
5. Copy the generated token

**Adding to GitHub:**
1. Go to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `NPM_TOKEN`
4. Value: [paste your npm token]
5. Click "Add secret"

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

All published packages include npm provenance attestation:
- Verifies package was built by GitHub Actions
- Links package to specific commit and workflow
- Visible as "Provenance" badge on npm package page

### Version Management

**Development workflow:**
- Work on `main` branch
- Each push publishes a new dev version
- Users can test latest: `npm install -g @orchestr8/cli@dev`

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

**"You must be logged in to publish packages"**
- Verify `NPM_TOKEN` secret is set in GitHub
- Check token is not expired
- Ensure token has publish permissions

**"You cannot publish over the previously published versions"**
- Version already exists on npm (this is normal)
- Workflow handles this gracefully
- Bump version in package.json if publishing manually

**"Package name too similar to existing package"**
- Scoped package name `@orchestr8/cli` prevents conflicts
- Ensure `publishConfig.access: "public"` is set

**Workflow not triggering:**
- Check branch name is exactly `main` or `release`
- Verify file changes match path filters
- Check GitHub Actions is enabled for repository

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
- [ ] Test install: `npm install -g @orchestr8/cli@latest`
- [ ] Verify binary works: `orchestr8 --version`
- [ ] Create GitHub release with tag
- [ ] Announce release in relevant channels

## Monitoring

Monitor published packages:
- npm package page: https://www.npmjs.com/package/@orchestr8/cli
- GitHub Actions runs: Repository → Actions → "Publish to npm"
- Download stats: npm package page → "Versions" tab
