[한국어](SETUP.ko.md)

# Self-Generation Setup and Usage Guide

Self-Generation is a system that automatically collects and analyzes Claude Code usage patterns to improve repetitive tasks through custom skills, CLAUDE.md directives, and hook workflows. This guide covers installation, configuration, usage, and troubleshooting.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Configuration (config.json)](#3-configuration-configjson)
4. [Basic Usage Guide](#4-basic-usage-guide)
5. [Uninstallation](#5-uninstallation)
6. [Troubleshooting](#6-troubleshooting)
7. [Privacy & Security](#7-privacy--security)

---

## 1. Prerequisites

### Node.js Version

Self-Generation uses `better-sqlite3` native bindings. Version compatibility is critical.

**Required**: Node.js v22 (or v18, v20)
**Warning**: Node.js v24 causes better-sqlite3 native build failures — avoid it

### Node Version Check and Setup

```bash
# Check current version
node --version

# Recommended: Use nvm (Node version manager)
# macOS/Linux:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# Restart nvm (close terminal and reopen, or):
source ~/.bashrc

# Install and use Node v22
nvm install 22
nvm use 22

# Verify
node --version  # Should show v22.x.x or higher
```

### Build Tools

Required for compiling `better-sqlite3`.

**macOS:**
```bash
# Install Xcode Command Line Tools
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

### Claude Code Installation

Claude Code CLI must be installed (verify with `claude --version`).

---

## 2. Installation

### Step 1: Clone Repository

```bash
# Clone repository
git clone https://github.com/JakeB-5/self-generation.git
cd self-generation

# (Or if already cloned)
cd /path/to/self-generation
```

### Step 2: Install Dependencies

```bash
# From project root
npm install

# Verify installation (takes ~2-3 minutes for native compilation)
npm test  # All 251 tests should pass
```

Expected output:
```
251 tests, 0 failures
ok - All tests passed
```

If issues occur, see [Troubleshooting](#6-troubleshooting).

### Step 3: System Installation

```bash
# Install Self-Generation system
node bin/install.mjs

# Expected output:
# 📁 Directory structure created
# 📦 package.json verified
# 📦 Dependencies installed
# ⚙️  config.json initialized
# 🔗 Hooks registered in settings.json
# ✅ self-generation installation complete.
```

#### Created Directory Structure

After installation, `~/.self-generation/` directory is created:

```
~/.self-generation/
├── config.json                 # System configuration
├── data/
│   └── self-gen.db            # Database (SQLite)
├── hooks/                      # 8 hook scripts
│   ├── prompt-logger.mjs       # UserPromptSubmit event
│   ├── tool-logger.mjs         # PostToolUse event
│   ├── error-logger.mjs        # PostToolUseFailure event
│   ├── pre-tool-guide.mjs      # PreToolUse event
│   ├── subagent-context.mjs    # SubagentStart event
│   ├── subagent-tracker.mjs    # SubagentStop event
│   ├── session-summary.mjs     # SessionEnd event
│   └── session-analyzer.mjs    # SessionStart event
├── hooks/auto/                 # Auto-generated hook workflows
├── lib/                        # 8 utility modules
├── prompts/
│   └── analyze.md             # AI analysis prompt template
└── bin/                        # 4 CLI tools
    ├── install.mjs
    ├── analyze.mjs
    ├── apply.mjs
    └── dismiss.mjs
```

#### Registered Hooks (8 total)

| Event | Script | Purpose | Timeout |
|-------|--------|---------|---------|
| `UserPromptSubmit` | prompt-logger.mjs | Collect prompts + skill matching | 5s |
| `PostToolUse` | tool-logger.mjs | Tool usage + resolution detection | 5s |
| `PostToolUseFailure` | error-logger.mjs | Error collection + KB search | 5s |
| `PreToolUse` | pre-tool-guide.mjs | File error history (Edit/Write/Bash/Task) | 5s |
| `SubagentStart` | subagent-context.mjs | Error pattern + AI rule injection | 5s |
| `SubagentStop` | subagent-tracker.mjs | Agent performance tracking | 5s |
| `SessionEnd` | session-summary.mjs | Session summary + AI analysis trigger | 10s |
| `SessionStart` | session-analyzer.mjs | Cache injection + context | 10s |

#### ~/.claude/settings.json Changes

After installation, hooks section is added to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "node ~/.self-generation/hooks/prompt-logger.mjs",
        "timeout": 5
      }
    ],
    "PostToolUse": [
      {
        "type": "command",
        "command": "node ~/.self-generation/hooks/tool-logger.mjs",
        "timeout": 5
      }
    ],
    // ... 6 more hooks
  }
}
```

### Step 4: Verify Installation

```bash
# Check config.json
cat ~/.self-generation/config.json

# Verify DB initialization
ls -lh ~/.self-generation/data/self-gen.db

# Verify hook registration
grep -A 5 "UserPromptSubmit" ~/.claude/settings.json
```

Expected output:
```bash
$ cat ~/.self-generation/config.json
{
  "enabled": true,
  "collectPromptText": true,
  "retentionDays": 90,
  "analysisModel": "claude-sonnet-4-5-20250929"
}

$ ls -lh ~/.self-generation/data/self-gen.db
-rw-r--r--  1 user  staff  131K Feb  9 12:34 ~/.self-generation/data/self-gen.db
```

---

## 3. Configuration (config.json)

Self-Generation is configured via `~/.self-generation/config.json`.

### Default Configuration File

```json
{
  "enabled": true,
  "collectPromptText": true,
  "retentionDays": 90,
  "analysisModel": "claude-sonnet-4-5-20250929"
}
```

### Configuration Fields

#### `enabled` (boolean, default: true)

Controls overall system activation.

- `true`: All hooks are active and collect data
- `false`: Hooks are registered but do not operate

```bash
# Pause system
jq '.enabled = false' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# Resume system
jq '.enabled = true' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### `collectPromptText` (boolean, default: true)

Controls whether full prompt text is stored in database (privacy).

- `true`: Store full prompt text for more accurate pattern analysis
- `false`: Store only prompt metadata (length, timestamp, sentiment, etc.)

For privacy-sensitive scenarios:
```bash
jq '.collectPromptText = false' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### `retentionDays` (number, default: 90)

Data retention period in days. Events older than this are automatically deleted.

```bash
# Change to 180 days
jq '.retentionDays = 180' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# Permanent retention (999999)
jq '.retentionDays = 999999' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### `analysisModel` (string, default: claude-sonnet-4-5-20250929)

Specifies which Claude model to use for AI pattern analysis. More powerful models provide more accurate analysis but cost more.

Possible values:
- `claude-opus-4-6` (highest quality, higher cost)
- `claude-sonnet-4-5-20250929` (recommended, balanced)
- `claude-haiku-4-5-20251001` (fast, lower cost)

```bash
# More accurate analysis (Opus)
jq '.analysisModel = "claude-opus-4-6"' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# Faster analysis (Haiku)
jq '.analysisModel = "claude-haiku-4-5-20251001"' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

### Verify Configuration Changes

```bash
# View current configuration
cat ~/.self-generation/config.json

# Validate JSON
jq . ~/.self-generation/config.json
```

---

## 4. Basic Usage Guide

### Automatic Collection

After installation, just use Claude Code normally. All data is collected automatically.

**Collected data:**
- Prompts (full or metadata only)
- Tool usage (Bash, Read, Edit, Write, Grep, Task, etc.)
- Error messages and resolutions
- Session summaries
- Skill usage

**Privacy protection:**
- Bash commands: Only first word (command name) stored
- `<private>` tags: Automatically removed
- Error messages: Paths, numbers, strings masked

### Run AI Pattern Analysis

After collecting at least 5 prompts, you can run analysis.

```bash
# Basic analysis (last 30 days)
node ~/.self-generation/bin/analyze.mjs

# Example output:
# === Self-Generation AI Pattern Analysis (Last 30 days) ===
#
# --- Repeated Prompt Clusters ---
#
#   [5x] typescript-setup - TypeScript project initialization
#     "Initialize TypeScript project with eslint and prettier"
#     "Create new TS project with linter setup"
#     "Set up TypeScript project"
#
# --- Repeated Tool Sequences ---
#
#   [12x] Grep → Read → Edit → Bash (test execution)
#
# --- Repeated Error Patterns ---
#
#   [8x] "Module not found"
#     → Rule: "Run npm install before tests"
#
# === Improvement Suggestions ===
#
# 1. [skill] Create typescript-init skill
#    Rationale: 5x repeated TypeScript project initialization pattern
#    Suggestion: Automate with /ts-init custom skill
#
# 2. [claude_md] Add rule to project CLAUDE.md
#    Rationale: "npm install is first step for all error resolutions"
#    Suggestion: Add "Run npm install first on test failures" to CLAUDE.md
#
# ---
# To apply suggestions: node ~/.self-generation/bin/apply.mjs <number>
```

#### Analysis Options

```bash
# Analyze last 60 days
node ~/.self-generation/bin/analyze.mjs --days 60

# Analyze specific project only
node ~/.self-generation/bin/analyze.mjs --project-path /path/to/project

# Analyze specific project (by name)
node ~/.self-generation/bin/analyze.mjs --project my-project
```

### Apply Suggestions

You can apply suggestions from analysis results.

#### 1. Apply Skill

Create a custom skill to automate repetitive tasks.

```bash
# Apply suggestion #1 (skill)
node ~/.self-generation/bin/apply.mjs 1

# Output:
# Skill created: /Users/user/.claude/commands/ts-init.md

# Create project-scoped skill
node ~/.self-generation/bin/apply.mjs 1 --project my-project

# Check created skill
cat ~/.claude/commands/ts-init.md

# Usage: Type `/ts-init` in Claude Code (autocomplete)
```

Example created skill file:
```markdown
# /ts-init

Generated from AI-detected repeated pattern.

## Detected Pattern
- 5x repeated TypeScript project initialization

## Execution Instructions

Initialize a TypeScript project:
1. Create package.json
2. Configure ESLint + Prettier
3. Configure tsconfig.json
```

#### 2. Apply CLAUDE.md Rule

Add recurring rules as project or global directives.

```bash
# Apply suggestion #2 (CLAUDE.md)
node ~/.self-generation/bin/apply.mjs 2

# Output:
# CLAUDE.md updated: /Users/user/.claude/CLAUDE.md

# Check created content
cat ~/.claude/CLAUDE.md

# Apply project-scoped rule
node ~/.self-generation/bin/apply.mjs 2 --project my-project

# Created locations:
# Project scope: /path/to/project/.claude/CLAUDE.md
# Global scope: ~/.claude/CLAUDE.md
```

Example created rule:
```markdown
## Auto-Detected Rules

- Run npm install first on test failures
- Always run npx tsc --noEmit for type checking after adding new dependencies
```

#### 3. Apply Hook Workflow

Register recurring tool sequences as automatic hooks.

```bash
# Apply suggestion #3 (hook)
node ~/.self-generation/bin/apply.mjs 3

# Output:
# ✅ Hook script created: ~/.self-generation/hooks/auto/workflow-xxxxx.mjs
#
# Manual registration: Add to ~/.claude/settings.json:
#   "PostToolUse": ["~/.self-generation/hooks/auto/workflow-xxxxx.mjs"]
#
# Or auto-register: node ~/.self-generation/bin/apply.mjs 3 --apply

# Auto-register to settings.json
node ~/.self-generation/bin/apply.mjs 3 --apply

# Verify registration
cat ~/.claude/settings.json | jq '.hooks.PostToolUse'
```

### Dismiss Suggestions

You can dismiss unwanted suggestions. Dismissed patterns are excluded from future analysis.

```bash
# Dismiss by suggestion ID
node ~/.self-generation/bin/dismiss.mjs "suggestion-abc123"

# Output:
# Suggestion dismissed: suggestion-abc123
# This pattern will be passed as exclusion context in future AI analysis.
```

### Inspect Database

Verify data is being collected properly.

```bash
# Inspect DB with SQLite CLI
sqlite3 ~/.self-generation/data/self-gen.db

# In DB shell prompt:
sqlite> SELECT COUNT(*) as event_count FROM events;
sqlite> SELECT type, COUNT(*) FROM events GROUP BY type;
sqlite> SELECT * FROM events LIMIT 1;
sqlite> .quit
```

---

## 5. Uninstallation

### Remove Hooks Only (Preserve Data)

```bash
# Remove hook registration (from settings.json only)
node ~/self-generation/bin/install.mjs --uninstall

# Output:
# ✅ self-generation hooks removed from settings.json.
#    To delete data: rm -rf ~/.self-generation

# Verify
grep -c "self-generation" ~/.claude/settings.json  # 0 or no lines
```

### Complete Removal (Including Data)

```bash
# Remove hooks + delete all data
node ~/.self-generation/bin/install.mjs --uninstall --purge

# Output:
# ✅ self-generation hooks removed from settings.json.
# 🗑️  Data directory and socket files deleted.

# Verify
ls ~/.self-generation  # Directory not found (or empty)
```

### Manual Cleanup

```bash
# Remove hooks only (preserve data)
rm -rf ~/.self-generation/hooks/

# Delete DB only
rm ~/.self-generation/data/self-gen.db*

# Complete deletion
rm -rf ~/.self-generation/

# Manually remove self-generation hooks from settings.json
# (Open ~/.claude/settings.json in editor → delete self-generation entries)
```

---

## 6. Troubleshooting

### Node Version Issues

#### Symptoms
```
error: 'sqlite3_vtab_alloc' is not a member of 'sqlite3'
npm ERR! gyp ERR! build error
```

#### Cause
Node.js v24 is incompatible with better-sqlite3.

#### Solution

```bash
# Check current version
node --version

# If v24, switch to v22
nvm install 22
nvm use 22

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Hooks Not Working

#### Symptoms
- Prompt/tool usage data not collected
- DB file modification time not changing

#### Causes
1. Hooks not registered in settings.json
2. `enabled: false` configuration
3. Hook script path errors

#### Solution

```bash
# 1. Verify hooks registered in settings.json
grep -l "self-generation" ~/.claude/settings.json

# 2. Check enabled setting
jq '.enabled' ~/.self-generation/config.json  # Should be true

# 3. Verify hook scripts exist
ls -la ~/.self-generation/hooks/

# 4. Reinstall
node ~/.self-generation/bin/install.mjs --uninstall
node ~/self-generation/bin/install.mjs

# 5. Restart Claude Code (CRITICAL!)
# Completely quit and restart Claude Code
```

### Database Lock Issues

#### Symptoms
```
sqlite error: database is locked
```

#### Cause
Multiple hooks accessing DB simultaneously. Self-Generation uses WAL (Write-Ahead Logging) mode to prevent this.

#### Solution

```bash
# Check WAL mode
sqlite3 ~/.self-generation/data/self-gen.db "PRAGMA journal_mode;"
# Result: wal

# If DB file corrupted, reinitialize
rm ~/.self-generation/data/self-gen.db*
node ~/.self-generation/bin/install.mjs

# Or complete reinstall
rm -rf ~/.self-generation/
node ~/self-generation/bin/install.mjs
```

### Embedding Daemon Issues

#### Symptoms
```
Error: connect ENOENT /tmp/self-gen-embed.sock
```

#### Cause
Embedding daemon not started. Usually occurs during first run when downloading ONNX model (120MB).

#### Solution

```bash
# Check socket file
ls -la /tmp/self-gen-embed.sock

# Check daemon logs (if available)
tail -20 ~/.self-generation/logs/daemon.log

# Restart
kill $(lsof -t /tmp/self-gen-embed.sock) 2>/dev/null
# Restart Claude Code

# Wait for model download (internet required)
# First run takes 3-5 minutes
```

### npm Installation Failures

#### Symptoms
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

#### Cause
Dependency conflicts or corrupted npm cache.

#### Solution

```bash
# Clean npm cache
npm cache clean --force

# Complete reinstall
rm -rf node_modules package-lock.json
npm install --no-save

# If still failing, reinstall npm/Node
nvm uninstall 22
nvm install 22
npm install
```

### Analysis Failures

#### Symptoms
```
Analysis failed: Error: claude not found
```

#### Cause
`claude` CLI command not installed or not in PATH.

#### Solution

```bash
# Check claude CLI installation
which claude
claude --version

# If not installed
npm install -g @anthropic-ai/sdk

# Or follow Anthropic official guide
# https://docs.anthropic.com/en/docs/claude-code
```

### No Data Collection

#### Symptoms
- events table exists in DB but no records
- "Insufficient data" message when running `analyze.mjs`

#### Causes
- Hooks not working
- `collectPromptText: false` set (only collecting prompts)
- Need minimum 5 events

#### Solution

```bash
# 1. Check hooks working (see "Hooks Not Working" above)

# 2. Check enabled setting
jq '.enabled' ~/.self-generation/config.json

# 3. Force test event creation
# Repeat 10 simple tasks in Claude Code (Bash, Read, Edit, etc.)
# Or programmatically:
node -e "
const db = require('better-sqlite3')('~/.self-generation/data/self-gen.db');
const count = db.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
console.log('Events:', count);
"

# 4. Rerun analysis
node ~/.self-generation/bin/analyze.mjs --days 1
```

---

## 7. Privacy & Security

### All Data Stored Locally

Self-Generation operates completely locally. Collected data is never transmitted to external servers.

```bash
# Check data location
ls -la ~/.self-generation/data/

# Check file size
du -h ~/.self-generation/

# Backup data
cp -r ~/.self-generation ~/.self-generation.backup
```

### Automatic Sensitive Information Protection

#### 1. Bash Commands - First Word Only

```bash
# Input: npm install --save-dev typescript
# Stored: npm
#
# Input: ssh user@host.com
# Stored: ssh

# Reason: Only command name needed for pattern recognition; arguments may contain sensitive info
```

#### 2. `<private>` Tags Auto-Removed

```
Prompt input:
"My API key is sk-xxxxx and <private>sensitive info</private>."

Stored:
"My API key is [REDACTED] and [REDACTED]."
```

#### 3. Error Message Normalization

```
Original:
"/Users/john/projects/myapp/src/index.ts:42:15 - error: Type 'string' is not assignable..."

Stored:
"<PATH>:<N>:<N> - error: Type '<STR>' is not assignable..."

Purpose: Mask personal paths, line numbers, specific values to analyze patterns only
```

### Privacy Settings - Disable Prompt Collection

You can disable storing full prompt text. Only metadata will be stored.

```bash
# Disable prompt collection
jq '.collectPromptText = false' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# Verify
jq '.collectPromptText' ~/.self-generation/config.json  # false
```

With this setting enabled:

**Stored data:**
- Prompt length (charCount)
- Timestamp
- Session ID, project info

**Not stored:**
- Full prompt text

### Data Deletion Policy

#### Automatic Deletion

Automatically deleted according to `retentionDays` setting in `config.json` (default: 90 days).

```bash
# Check current retention period
jq '.retentionDays' ~/.self-generation/config.json

# Shorten to 30 days
jq '.retentionDays = 30' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### Manual Deletion

```bash
# Delete specific project data only
sqlite3 ~/.self-generation/data/self-gen.db \
  "DELETE FROM events WHERE project_path = '/path/to/project';"

# Delete all data before specific date
sqlite3 ~/.self-generation/data/self-gen.db \
  "DELETE FROM events WHERE ts < '2025-01-09T00:00:00Z';"

# Delete all
sqlite3 ~/.self-generation/data/self-gen.db \
  "DELETE FROM events; VACUUM;"
```

### Security Considerations

#### 1. File Permissions

Self-Generation directory is automatically created with appropriate permissions.

```bash
# Check permissions (should be user read/write only)
ls -ld ~/.self-generation
# Expected: drwx------ (700)

# Set permissions if needed
chmod 700 ~/.self-generation
chmod 700 ~/.self-generation/data
chmod 600 ~/.self-generation/data/self-gen.db
```

#### 2. Network Safety

Self-Generation requires network communication:

- **Claude API calls**: Only when running Claude in headless mode (during AI analysis)
- **Model download**: First run downloads ONNX embedding model (120MB)
- **Claude Code communication**: Hook scripts are local processes (no network)

#### 3. Embedding Model

`@xenova/transformers` runs locally only. No models or data transmitted externally.

```bash
# Embedding model cache location
ls -la ~/.self-generation/models/
```

---

## Additional Resources

### Key Documents

- **DESIGN.md**: Complete system architecture and implementation spec (3869 lines)
- **CLAUDE.md**: Project overview and tech stack
- **.sdd/constitution.md**: Project principles and constraints

### Command Summary

```bash
# Installation
npm install
node bin/install.mjs

# Analysis (30 days default)
node ~/.self-generation/bin/analyze.mjs
node ~/.self-generation/bin/analyze.mjs --days 60
node ~/.self-generation/bin/analyze.mjs --project-path /path/to/project

# Apply suggestions
node ~/.self-generation/bin/apply.mjs 1          # Apply suggestion 1
node ~/.self-generation/bin/apply.mjs 1 --apply  # Auto-register hook

# Dismiss suggestions
node ~/.self-generation/bin/dismiss.mjs "id"

# Uninstallation
node bin/install.mjs --uninstall                 # Remove hooks only
node bin/install.mjs --uninstall --purge         # Complete removal

# Modify configuration
jq '.enabled = false' ~/.self-generation/config.json | tee ~/.self-generation/config.json
jq '.collectPromptText = false' ~/.self-generation/config.json | tee ~/.self-generation/config.json
jq '.retentionDays = 180' ~/.self-generation/config.json | tee ~/.self-generation/config.json

# Check data
sqlite3 ~/.self-generation/data/self-gen.db "SELECT COUNT(*) FROM events;"
cat ~/.self-generation/config.json | jq .
```

### FAQ

**Q: No data collected after installation.**
A: Completely restart Claude Code. Hooks are loaded when Claude Code starts.

**Q: How to avoid storing prompts?**
A: Set `collectPromptText: false`. Only metadata will be stored.

**Q: Analysis results unsatisfactory.**
A: More data needed (minimum 30 events recommended). Or change `analysisModel` to `claude-opus-4-6` for more accurate analysis.

**Q: Will it overwrite existing skills?**
A: No. If a skill with the same name exists, new skill creation is skipped.

**Q: Can data be transferred to another computer?**
A: Yes. Just copy `~/.self-generation/data/self-gen.db`. The DB is self-contained.

---

**This guide is based on Self-Generation v0.1.0. (2026-02-09)**
