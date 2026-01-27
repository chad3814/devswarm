import { customAlphabet } from 'nanoid';

// Use lowercase alphanumeric for short IDs (no underscores or hyphens)
const nanoidShort = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

/**
 * Convert a title to a URL-safe slug
 * - Lowercase
 * - Replace spaces and special chars with hyphens
 * - Remove consecutive hyphens
 * - Trim hyphens from ends
 * - Limit to 50 characters
 */
export function generateSlug(title: string): string {
    return (
        title
            .toLowerCase()
            .trim()
            // Replace non-alphanumeric with hyphens
            .replace(/[^a-z0-9]+/g, '-')
            // Remove consecutive hyphens
            .replace(/-+/g, '-')
            // Remove leading/trailing hyphens
            .replace(/^-|-$/g, '')
            // Limit length
            .slice(0, 50) || 'untitled'
    );
}

/**
 * Generate a semantic spec ID based on roadmap item source and title
 */
export function generateSpecId(roadmapItem: {
    github_issue_id: number | null;
    title: string;
}): string {
    const slug = generateSlug(roadmapItem.title);

    if (roadmapItem.github_issue_id) {
        // GitHub issue: iss-${number}-${slug}
        return `iss-${roadmapItem.github_issue_id}-${slug}`;
    } else {
        // Live/web interface: live-${slug}-${shortId}
        const shortId = nanoidShort();
        return `live-${slug}-${shortId}`;
    }
}
