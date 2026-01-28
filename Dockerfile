FROM node:22-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    jq \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# Create non-root user first (claude CLI install needs home directory)
RUN useradd -m -s /bin/bash devswarm

# Volume mount point
VOLUME /data

RUN mkdir -p /data && chown -R devswarm /data

# Switch to non-root user for claude CLI install
USER devswarm
WORKDIR /home/devswarm

# Claude Code CLI (installed as user)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Verify claude is installed
RUN ~/.local/bin/claude --version || echo "Claude CLI installed"

# Pre-configure Claude settings (theme, etc.) to skip first-run prompts
RUN mkdir -p ~/.claude && echo '{"theme":"dark","hasCompletedOnboarding":true}' > ~/.claude/settings.json

# Add claude to PATH
ENV PATH="/home/devswarm/.local/bin:${PATH}"

# Configure git to use gh CLI for authentication
RUN git config --global credential.helper '!gh auth git-credential' \
    && git config --global user.name "Orchestr8" \
    && git config --global user.email "devswarm@localhost"

# App dependencies (copied separately for layer caching)
COPY --chown=devswarm:devswarm package.json ./
COPY --chown=devswarm:devswarm packages/cli/package.json ./packages/cli/
COPY --chown=devswarm:devswarm packages/server/package.json ./packages/server/
COPY --chown=devswarm:devswarm packages/web/package.json ./packages/web/
RUN npm i

# App source
COPY --chown=devswarm:devswarm . .

# Build the app
RUN npm run build

# Make o8 CLI available globally
RUN ln -sf /home/devswarm/packages/server/dist/cli/o8.js /home/devswarm/.local/bin/o8

# Exposed port range and git daemon
EXPOSE 3814-3850
EXPOSE 9418

ENV GITHUB_CLIENT_ID=Ov23liSCBgcipF0N4JjU

ENTRYPOINT ["/home/devswarm/entrypoint.sh"]
