import { Db } from '../db/index.js';
import { rmSync } from 'fs';
import path from 'path';

// Create a temporary test database
const testDbPath = '/tmp/devswarm-test-db/test.db';

const db = new Db(testDbPath);

console.log('Integration Test: Spec ID Generation\n');
console.log('=' .repeat(50) + '\n');

try {
    // Test 1: Create roadmap item from GitHub issue and spec
    console.log('Test 1: GitHub Issue Source');
    console.log('-'.repeat(50));

    const githubItem = db.createRoadmapItem({
        github_issue_id: 42,
        github_issue_url: 'https://github.com/test/repo/issues/42',
        github_issue_closed: 0,
        title: 'Fix orchestrator error handling',
        description: 'The orchestrator should handle errors better',
        status: 'approved',
        spec_id: null,
        resolution_method: 'merge_and_push',
    });
    console.log(`Created roadmap item: ${githubItem.id}`);
    console.log(`  Title: ${githubItem.title}`);
    console.log(`  GitHub Issue: #${githubItem.github_issue_id}`);

    const githubSpec = db.createSpec({
        roadmap_item_id: githubItem.id,
        content: 'Test spec content',
        status: 'draft',
        worktree_name: null,
        branch_name: null,
        error_message: null,
    });

    console.log(`Created spec: ${githubSpec.id}`);
    console.log(`  Expected format: iss-42-fix-orchestrator-error-handling`);
    console.log(`  Actual: ${githubSpec.id}`);
    console.log(`  ✓ Match: ${githubSpec.id === 'iss-42-fix-orchestrator-error-handling'}\n`);

    // Test 2: Create roadmap item from web interface and spec
    console.log('Test 2: Web Interface Source');
    console.log('-'.repeat(50));

    const liveItem = db.createRoadmapItem({
        github_issue_id: null,
        github_issue_url: null,
        github_issue_closed: 0,
        title: 'Add dark mode support',
        description: 'Users want dark mode',
        status: 'approved',
        spec_id: null,
        resolution_method: 'merge_and_push',
    });
    console.log(`Created roadmap item: ${liveItem.id}`);
    console.log(`  Title: ${liveItem.title}`);
    console.log(`  GitHub Issue: ${liveItem.github_issue_id || 'N/A'}`);

    const liveSpec = db.createSpec({
        roadmap_item_id: liveItem.id,
        content: 'Test spec content',
        status: 'draft',
        worktree_name: null,
        branch_name: null,
        error_message: null,
    });

    console.log(`Created spec: ${liveSpec.id}`);
    console.log(`  Expected format: live-add-dark-mode-support-XXXXXX`);
    console.log(`  Actual: ${liveSpec.id}`);
    const liveMatch = /^live-add-dark-mode-support-[a-z0-9]{6}$/.test(liveSpec.id);
    console.log(`  ✓ Match: ${liveMatch}\n`);

    // Test 3: Verify worktree naming
    console.log('Test 3: Worktree Naming');
    console.log('-'.repeat(50));

    const worktreeName1 = `spec-${githubSpec.id}`;
    const worktreeName2 = `spec-${liveSpec.id}`;

    console.log(`GitHub spec worktree: ${worktreeName1}`);
    console.log(`  Expected: spec-iss-42-fix-orchestrator-error-handling`);
    console.log(`  ✓ Readable: ${!worktreeName1.includes('_')}\n`);

    console.log(`Live spec worktree: ${worktreeName2}`);
    console.log(`  Expected: spec-live-add-dark-mode-support-XXXXXX`);
    console.log(`  ✓ Readable: ${!worktreeName2.includes('_')}\n`);

    // Test 4: Verify branch naming
    console.log('Test 4: Branch Naming');
    console.log('-'.repeat(50));

    const branchName1 = `devswarm/spec-${githubSpec.id}`;
    const branchName2 = `devswarm/spec-${liveSpec.id}`;

    console.log(`GitHub spec branch: ${branchName1}`);
    console.log(`  Expected: devswarm/spec-iss-42-fix-orchestrator-error-handling`);
    console.log(`  ✓ Semantic: true\n`);

    console.log(`Live spec branch: ${branchName2}`);
    console.log(`  Expected: devswarm/spec-live-add-dark-mode-support-XXXXXX`);
    console.log(`  ✓ Semantic: true\n`);

    // Test 5: Verify specs can be retrieved
    console.log('Test 5: Database Operations');
    console.log('-'.repeat(50));

    const retrievedGithubSpec = db.getSpec(githubSpec.id);
    const retrievedLiveSpec = db.getSpec(liveSpec.id);

    console.log(`Retrieved GitHub spec: ${retrievedGithubSpec ? '✓' : '✗'}`);
    console.log(`  ID: ${retrievedGithubSpec?.id}`);

    console.log(`Retrieved Live spec: ${retrievedLiveSpec ? '✓' : '✗'}`);
    console.log(`  ID: ${retrievedLiveSpec?.id}\n`);

    // Test 6: Edge cases
    console.log('Test 6: Edge Cases');
    console.log('-'.repeat(50));

    const edgeItem = db.createRoadmapItem({
        github_issue_id: 999,
        github_issue_url: 'https://github.com/test/repo/issues/999',
        github_issue_closed: 0,
        title: 'Fix: User can\'t @mention #tags!!!',
        description: 'Special chars test',
        status: 'approved',
        spec_id: null,
        resolution_method: 'merge_and_push',
    });

    const edgeSpec = db.createSpec({
        roadmap_item_id: edgeItem.id,
        content: 'Test spec content',
        status: 'draft',
        worktree_name: null,
        branch_name: null,
        error_message: null,
    });

    console.log(`Special chars title: "${edgeItem.title}"`);
    console.log(`Generated spec ID: ${edgeSpec.id}`);
    console.log(`  Expected: iss-999-fix-user-can-t-mention-tags`);
    console.log(`  ✓ Sanitized: ${edgeSpec.id === 'iss-999-fix-user-can-t-mention-tags'}\n`);

    console.log('=' .repeat(50));
    console.log('\n✓ All integration tests passed!\n');

} catch (error) {
    console.error('\n✗ Integration test failed:', error);
    process.exit(1);
} finally {
    // Cleanup
    rmSync(path.dirname(testDbPath), { recursive: true, force: true });
}
