/**
 * GitHub issue body parser for extracting dependency references
 */

export interface ParsedDependencies {
    taskListReferences: number[];
    blockedByReferences: number[];
    checkedTaskReferences: number[];
}

/**
 * Parse task list references from GitHub issue body
 * Matches patterns like:
 * - [ ] #123
 * - [x] #456
 * - [ ] Implement feature #789
 */
export function parseTaskListReferences(body: string | null): { unchecked: number[]; checked: number[] } {
    if (!body) return { unchecked: [], checked: [] };

    const unchecked: number[] = [];
    const checked: number[] = [];

    // Match unchecked task list items with issue references
    const uncheckedPattern = /^[\s-]*\[\s\]\s+.*?#(\d+)/gm;
    let match;
    while ((match = uncheckedPattern.exec(body)) !== null) {
        const issueNumber = parseInt(match[1], 10);
        if (!isNaN(issueNumber) && !unchecked.includes(issueNumber)) {
            unchecked.push(issueNumber);
        }
    }

    // Match checked task list items with issue references
    const checkedPattern = /^[\s-]*\[[xX]\]\s+.*?#(\d+)/gm;
    while ((match = checkedPattern.exec(body)) !== null) {
        const issueNumber = parseInt(match[1], 10);
        if (!isNaN(issueNumber) && !checked.includes(issueNumber)) {
            checked.push(issueNumber);
        }
    }

    return { unchecked, checked };
}

/**
 * Parse "Blocked by" or "Depends on" references from GitHub issue body
 * Matches patterns like:
 * - Blocked by #123
 * - Depends on #456
 * - blocked by #789 (case insensitive)
 */
export function parseBlockedByReferences(body: string | null): number[] {
    if (!body) return [];

    const references: number[] = [];

    // Match various "blocked by" and "depends on" patterns
    const patterns = [
        /blocked\s+by\s+#(\d+)/gi,
        /depends\s+on\s+#(\d+)/gi,
        /requires\s+#(\d+)/gi,
        /waiting\s+(?:on|for)\s+#(\d+)/gi,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(body)) !== null) {
            const issueNumber = parseInt(match[1], 10);
            if (!isNaN(issueNumber) && !references.includes(issueNumber)) {
                references.push(issueNumber);
            }
        }
    }

    return references;
}

/**
 * Parse all dependencies from a GitHub issue body
 */
export function parseIssueDependencies(body: string | null): ParsedDependencies {
    const taskLists = parseTaskListReferences(body);
    const blockedBy = parseBlockedByReferences(body);

    return {
        taskListReferences: taskLists.unchecked,
        blockedByReferences: blockedBy,
        checkedTaskReferences: taskLists.checked,
    };
}
