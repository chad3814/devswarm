# Testing Notes for Auto-Push Feature

## Implementation Complete

The main Claude prompt has been updated to include explicit merge workflow instructions that require pushing to origin after successful merges.

## What Was Changed

Updated `packages/server/src/claude/prompts.ts` - MAIN_CLAUDE_PROMPT now includes:

1. **Merge Workflow section** with 5-step process:
   - Review the changes in coordinator's worktree
   - Merge to main using git commands
   - Push to origin: `cd /data/worktrees/main && git push origin main`
   - Handle push failures (log error, don't mark spec done, report issue)
   - Mark spec complete only after successful push

2. **Error handling instructions**: Push failures should not mark spec as done
3. **Explicit push command**: Full path and command documented
4. **Timing requirement**: Push must succeed before marking spec complete

## How to Test (For Main Claude Instance)

When the main Claude instance next completes a merge:

1. **Test successful push**:
   - Complete a spec implementation
   - Let main Claude merge it to main branch
   - Verify main Claude executes: `cd /data/worktrees/main && git push origin main`
   - Check that remote repository receives the commits
   - Verify spec is marked as done only after successful push

2. **Test push failure handling**:
   - Simulate a push failure (disconnect network, or create a conflict scenario)
   - Verify main Claude logs the error clearly
   - Verify spec is NOT marked as done
   - Verify main Claude reports the issue

## Expected Behavior

After this change is deployed:
- Every successful spec merge will automatically push to origin
- Remote repository will stay in sync with local main branch
- No manual intervention needed for normal merge operations
- Push failures will be properly reported and block spec completion

## Notes

This implementation follows Option 1 from the spec (prompt update) rather than Option 2 (orchestrator automation) because:
- Gives main Claude control and flexibility
- Better error handling capability
- User can see push happening in Claude's output
- Simpler implementation (no orchestrator code changes)
- Keeps merge workflow in one place
