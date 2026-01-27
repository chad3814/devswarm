import { generateSlug, generateSpecId } from './slug.js';

console.log('Testing generateSlug...\n');

// Test 1: Normal titles
console.log('Test 1: Normal titles');
console.assert(generateSlug('Fix orchestrator error') === 'fix-orchestrator-error', 'Failed: normal title');
console.log(`  'Fix orchestrator error' -> '${generateSlug('Fix orchestrator error')}'`);

// Test 2: Special characters
console.log('\nTest 2: Special characters');
console.assert(generateSlug('Add feature: user @mentions') === 'add-feature-user-mentions', 'Failed: special chars');
console.log(`  'Add feature: user @mentions' -> '${generateSlug('Add feature: user @mentions')}'`);

// Test 3: Very long titles
console.log('\nTest 3: Very long titles');
const longTitle = 'A'.repeat(100);
const longSlug = generateSlug(longTitle);
console.assert(longSlug.length <= 50, 'Failed: long title should be truncated');
console.log(`  '${'A'.repeat(100)}' -> '${longSlug}' (length: ${longSlug.length})`);

// Test 4: Empty titles
console.log('\nTest 4: Empty titles');
console.assert(generateSlug('') === 'untitled', 'Failed: empty string');
console.assert(generateSlug('   ') === 'untitled', 'Failed: whitespace only');
console.log(`  '' -> '${generateSlug('')}'`);
console.log(`  '   ' -> '${generateSlug('   ')}'`);

// Test 5: Unicode
console.log('\nTest 5: Unicode characters');
const unicodeSlug = generateSlug('Add 日本語 support');
console.log(`  'Add 日本語 support' -> '${unicodeSlug}'`);

// Test 6: Consecutive special chars
console.log('\nTest 6: Consecutive special chars');
console.assert(generateSlug('Fix --- bug!!!') === 'fix-bug', 'Failed: consecutive special chars');
console.log(`  'Fix --- bug!!!' -> '${generateSlug('Fix --- bug!!!')}'`);

// Test 7: Numbers and mixed case
console.log('\nTest 7: Numbers and mixed case');
console.assert(generateSlug('Update API v2.0 Endpoint') === 'update-api-v2-0-endpoint', 'Failed: numbers and mixed case');
console.log(`  'Update API v2.0 Endpoint' -> '${generateSlug('Update API v2.0 Endpoint')}'`);

// Test 8: Leading/trailing spaces and hyphens
console.log('\nTest 8: Leading/trailing spaces and hyphens');
console.assert(generateSlug('  --- Fix Memory Leak ---  ') === 'fix-memory-leak', 'Failed: leading/trailing cleanup');
console.log(`  '  --- Fix Memory Leak ---  ' -> '${generateSlug('  --- Fix Memory Leak ---  ')}'`);

console.log('\n\nTesting generateSpecId...\n');

// Test 9: GitHub issue format
console.log('Test 9: GitHub issue format');
const githubId = generateSpecId({
    github_issue_id: 42,
    title: 'Fix the bug',
});
console.assert(githubId === 'iss-42-fix-the-bug', 'Failed: GitHub issue format');
console.log(`  Issue #42 'Fix the bug' -> '${githubId}'`);

// Test 10: Live item format
console.log('\nTest 10: Live item format');
const liveId = generateSpecId({
    github_issue_id: null,
    title: 'Add dark mode',
});
console.assert(/^live-add-dark-mode-[a-z0-9]{6}$/.test(liveId), 'Failed: live item format');
console.log(`  Live 'Add dark mode' -> '${liveId}'`);

// Test 11: Unique IDs for duplicate titles
console.log('\nTest 11: Unique IDs for duplicate titles');
const id1 = generateSpecId({ github_issue_id: null, title: 'Same title' });
const id2 = generateSpecId({ github_issue_id: null, title: 'Same title' });
console.assert(id1 !== id2, 'Failed: should generate unique IDs');
console.log(`  First:  '${id1}'`);
console.log(`  Second: '${id2}'`);

// Test 12: Edge case - all special characters
console.log('\nTest 12: Edge case - all special characters');
const specialCharsId = generateSpecId({
    github_issue_id: 99,
    title: '@#$%^&*()',
});
console.assert(specialCharsId === 'iss-99-untitled', 'Failed: all special chars should become untitled');
console.log(`  Issue #99 '@#$%^&*()' -> '${specialCharsId}'`);

console.log('\n\nAll tests completed!');
