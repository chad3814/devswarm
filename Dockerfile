FROM node:22-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    tmux \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# Create non-root user first (claude CLI install needs home directory)
RUN useradd -m -s /bin/bash orchestr8

# Volume mount point
VOLUME /data

RUN mkdir -p /data && chown -R orchestr8 /data

# Switch to non-root user for claude CLI install
USER orchestr8
WORKDIR /home/orchestr8

# Claude Code CLI (installed as user)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Verify claude is installed
RUN ~/.claude/bin/claude --version || echo "Claude CLI installed"

# Add claude to PATH
ENV PATH="/home/orchestr8/.claude/bin:${PATH}"

# App dependencies (copied separately for layer caching)
COPY --chown=orchestr8:orchestr8 package.json ./
COPY --chown=orchestr8:orchestr8 packages/cli/package.json ./packages/cli/
COPY --chown=orchestr8:orchestr8 packages/server/package.json ./packages/server/
COPY --chown=orchestr8:orchestr8 packages/web/package.json ./packages/web/
RUN npm i

# App source
COPY --chown=orchestr8:orchestr8 . .

# Build the app
RUN npm run build

# Exposed port range and git daemon
EXPOSE 3814-3850
EXPOSE 9418

ENTRYPOINT ["/home/orchestr8/entrypoint.sh"]
