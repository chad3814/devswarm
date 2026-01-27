/**
 * Unit tests for GitHub issue body parser
 */

import { parseTaskListReferences, parseBlockedByReferences, parseIssueDependencies } from './issue-parser.js';
import { strict as assert } from 'assert';

console.log('Running GitHub issue parser tests...\n');

// Test parseTaskListReferences
console.log('Testing parseTaskListReferences...');

// Test 1: Parse unchecked task list items
const body1 = `
# TODO
- [ ] Implement feature #123
- [ ] Fix bug #456
- [x] Already done #789
`;
const result1 = parseTaskListReferences(body1);
assert.deepEqual(result1.unchecked, [123, 456], 'Should extract unchecked task references');
assert.deepEqual(result1.checked, [789], 'Should extract checked task references');
console.log('✓ Test 1 passed: Parse task list items');

// Test 2: Handle null/empty body
const result2 = parseTaskListReferences(null);
assert.deepEqual(result2.unchecked, [], 'Should return empty array for null body');
assert.deepEqual(result2.checked, [], 'Should return empty array for null body');
console.log('✓ Test 2 passed: Handle null body');

// Test 3: Ignore duplicates
const body3 = `
- [ ] Do thing #100
- [ ] Do other thing #100
- [x] Done #100
`;
const result3 = parseTaskListReferences(body3);
assert.deepEqual(result3.unchecked, [100], 'Should remove duplicate issue numbers');
assert.deepEqual(result3.checked, [100], 'Should remove duplicate issue numbers');
console.log('✓ Test 3 passed: Ignore duplicates');

// Test 4: Various task list formats
const body4 = `
- [ ] #200
  - [ ] Sub-task #201
    - [ ] Nested #202
-  [x]  Spaces #203
- [X] Uppercase X #204
`;
const result4 = parseTaskListReferences(body4);
assert(result4.unchecked.includes(200), 'Should parse simple format');
assert(result4.unchecked.includes(201), 'Should parse indented tasks');
assert(result4.unchecked.includes(202), 'Should parse nested tasks');
assert(result4.checked.includes(203), 'Should handle extra spaces');
assert(result4.checked.includes(204), 'Should handle uppercase X');
console.log('✓ Test 4 passed: Various task list formats');

// Test parseBlockedByReferences
console.log('\nTesting parseBlockedByReferences...');

// Test 5: Parse "blocked by" references
const body5 = `
This is blocked by #300
Also depends on #301
`;
const result5 = parseBlockedByReferences(body5);
assert.deepEqual(result5.sort(), [300, 301].sort(), 'Should extract blocked by references');
console.log('✓ Test 5 passed: Parse blocked by references');

// Test 6: Case insensitive matching
const body6 = `
Blocked by #400
DEPENDS ON #401
requires #402
Waiting on #403
waiting for #404
`;
const result6 = parseBlockedByReferences(body6);
assert.deepEqual(result6.sort(), [400, 401, 402, 403, 404].sort(), 'Should be case insensitive');
console.log('✓ Test 6 passed: Case insensitive matching');

// Test 7: No duplicates in blocked by
const body7 = `
Blocked by #500
Also blocked by #500
Depends on #500
`;
const result7 = parseBlockedByReferences(body7);
assert.deepEqual(result7, [500], 'Should remove duplicate blocked by references');
console.log('✓ Test 7 passed: No duplicates');

// Test parseIssueDependencies
console.log('\nTesting parseIssueDependencies...');

// Test 8: Combined parsing
const body8 = `
# Feature X

This feature is blocked by #600 and depends on #601

## Tasks
- [ ] Implement #602
- [ ] Test #603
- [x] Setup #604

Waiting on #605
`;
const result8 = parseIssueDependencies(body8);
assert(result8.blockedByReferences.includes(600), 'Should include blocked by #600');
assert(result8.blockedByReferences.includes(601), 'Should include depends on #601');
assert(result8.blockedByReferences.includes(605), 'Should include waiting on #605');
assert(result8.taskListReferences.includes(602), 'Should include unchecked task #602');
assert(result8.taskListReferences.includes(603), 'Should include unchecked task #603');
assert(result8.checkedTaskReferences.includes(604), 'Should include checked task #604');
console.log('✓ Test 8 passed: Combined parsing');

// Test 9: Edge cases
const body9 = `
# Edge Cases
- Not a task list item: #700
PR reference #701 (will be filtered later)
Issue without keyword #702
#703 at start of line
`;
const result9 = parseIssueDependencies(body9);
// These should NOT be picked up as they don't match our patterns
assert(!result9.taskListReferences.includes(700), 'Should not match non-task list items');
assert(!result9.blockedByReferences.includes(702), 'Should not match references without keywords');
console.log('✓ Test 9 passed: Edge cases');

// Test 10: Malformed references
const body10 = `
- [ ] Task with no number #
- [ ] Task with letter #abc
- [ ] Valid task #800
Blocked by #
Depends on #xyz
Requires #801
`;
const result10 = parseIssueDependencies(body10);
assert(result10.taskListReferences.includes(800), 'Should include valid task reference');
assert(result10.blockedByReferences.includes(801), 'Should include valid blocked by reference');
assert.equal(result10.taskListReferences.length, 1, 'Should have exactly 1 task reference');
assert.equal(result10.blockedByReferences.length, 1, 'Should have exactly 1 blocked by reference');
console.log('✓ Test 10 passed: Malformed references');

console.log('\n✅ All tests passed!');
