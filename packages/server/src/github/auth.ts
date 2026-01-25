import { config } from '../config.js';
import fs from 'fs/promises';

// You'll need to create a GitHub OAuth App and set this
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'Iv1.xxxxxxxxxxxxxxxx';

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

export class GitHubAuth {
    private deviceCode?: string;
    private interval = 5;

    async startDeviceFlow(): Promise<{ userCode: string; verificationUri: string; expiresIn: number }> {
        const res = await fetch('https://github.com/login/device/code', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                scope: 'repo read:org',
            }),
        });

        const data: DeviceCodeResponse = await res.json();

        this.deviceCode = data.device_code;
        this.interval = data.interval;

        return {
            userCode: data.user_code,
            verificationUri: data.verification_uri,
            expiresIn: data.expires_in,
        };
    }

    async pollForToken(): Promise<{ token: string } | { pending: true } | { error: string }> {
        if (!this.deviceCode) {
            return { error: 'No device flow started' };
        }

        const res = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                device_code: this.deviceCode,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            }),
        });

        const data = await res.json();

        if (data.access_token) {
            await this.saveToken(data.access_token);
            return { token: data.access_token };
        }

        if (data.error === 'authorization_pending') {
            return { pending: true };
        }

        return { error: data.error_description || data.error };
    }

    private async saveToken(token: string): Promise<void> {
        const ghConfigDir = `${config.configPath}/gh`;

        await fs.mkdir(ghConfigDir, { recursive: true });

        const hostsYaml = `github.com:
    oauth_token: ${token}
    user: ""
    git_protocol: https
`;

        await fs.writeFile(`${ghConfigDir}/hosts.yml`, hostsYaml);
    }

    async isAuthenticated(): Promise<boolean> {
        // Check for GH_TOKEN env var first (passed from CLI)
        if (process.env.GH_TOKEN) {
            return true;
        }

        // Fall back to checking hosts.yml file
        try {
            await fs.access(`${config.configPath}/gh/hosts.yml`);
            return true;
        } catch {
            return false;
        }
    }

    async getToken(): Promise<string | null> {
        // Check for GH_TOKEN env var first (passed from CLI)
        if (process.env.GH_TOKEN) {
            return process.env.GH_TOKEN;
        }

        // Fall back to reading from hosts.yml file
        try {
            const content = await fs.readFile(`${config.configPath}/gh/hosts.yml`, 'utf-8');
            const match = content.match(/oauth_token:\s*(\S+)/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }
}
