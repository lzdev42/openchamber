# OpenChamber

A fork of [OpenChamber](https://github.com/btriapitsyn/openchamber) with an **AI Router** layer for robust, provider-agnostic AI workflows.

---

## What's Different

This fork adds an **AI Router** that solves two practical problems when chaining multiple AI providers:

1. **Unified `thinking` parameter** — Different providers expose "reasoning/thinking" mode via incompatible parameter names and formats. The AI Router normalizes these so you can switch providers without rewriting prompts or API calls.

2. **Automatic failover** — If an API endpoint goes down or returns an error, the AI Router automatically reroutes the request to a backup provider, preventing automated workflows from silently stopping mid-task.

Everything else stays identical to upstream OpenChamber.

---

## Quick Start

> **Prerequisite:** Desktop bundles the matching OpenCode CLI. CLI/Web and VS Code use your installed [OpenCode CLI](https://opencode.ai).

### **Desktop (macOS + Windows)**
Download from [Releases](https://github.com/lzdev42/openchamber/releases).

### **VS Code**
Install from [Marketplace](https://marketplace.visualstudio.com/items?itemName=fedaykindev.openchamber) or search "OpenChamber" in Extensions.

### **CLI (Web + PWA)**
_requires Node.js 22+_

```bash
curl -fsSL https://raw.githubusercontent.com/lzdev42/openchamber/main/scripts/install.sh | bash
openchamber --ui-password be-creative-here
```

---

## Features

### Core (all app versions)

- Branchable chat timeline with `/undo`, `/redo`, and one-click forks from earlier turns
- Smart tool UIs for diffs, file operations, permissions, and long-running task progress
- Voice mode with speech input and read-aloud responses for hands-free workflows
- Multi-agent runs from one prompt with isolated worktrees for safe side-by-side comparisons
- Git workflows in-app: identities, commits, PR creation, checks, and merge actions
- GitHub-native workflows: start sessions from issues and pull requests with context already attached
- Plan/Build mode with a dedicated plan view for drafting and iterating implementation steps
- Inline comment drafts on diffs, files, and plans that can be sent back to the agent
- Context visibility tools (token/cost breakdowns, raw message inspection, and activity summaries)
- Integrated terminal with per-directory sessions and stable performance on heavy output
- Built-in skills catalog and local skill management for reusable automation workflows
- **AI Router** — unified thinking parameter handling and automatic provider failover

### Web / PWA

- Provider-aware tunnel access model with Cloudflare `quick`, `managed-remote`, and `managed-local` modes
- One-scan onboarding with tunnel QR + password URL helpers
- Mobile-first experience: optimized chat controls, keyboard-safe layouts, and attachment-friendly UI
- Background notifications plus reliable cross-tab session activity tracking
- Built-in self-update + restart flow that keeps your server settings intact

### Desktop (macOS + Windows)

- Floating Mini Chat: keep a small always-on-top assistant beside your editor, browser, or terminal
- Multiple native windows for separate projects or sessions
- Native notifications for task alerts while OpenChamber is hidden
- One-click open in VS Code, Cursor, Terminal, Finder, Explorer, and more
- Desktop host switcher for local and remote OpenChamber instances
- Convenient tunnel management without manual setup
- Deep-link connections for joining remote OpenChamber from a link
- SSH remote access with host import, connection management, and port forwarding

### VS Code Extension

- Editor-native workflow: open files directly from tool output and keep sessions beside your code
- Agent Manager for parallel multi-model runs from a single prompt
- Right-click actions to add context, explain selections, and improve code in-place
- In-extension settings, responsive layout, and theme mapping that matches your editor
- Hardened runtime lifecycle and health checks for faster startup and fewer stuck reconnect states

---

## License

MIT
