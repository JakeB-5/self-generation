[한국어](README.ko.md)

# Self-Generation: Claude Code Auto-Improvement System

An autonomous system that collects and analyzes Claude Code usage patterns to automatically suggest custom skills, CLAUDE.md directives, and hook workflows.

## Overview

Self-Generation uses the Claude Code Hooks API to collect user prompts, tool usage, and errors, then analyzes patterns using Claude in headless mode to generate custom directives for automating repetitive tasks.

- **Target environment**: Vanilla Claude Code (no plugins required)
- **Deployment status**: Phase 1-5 complete (251 tests passing)
- **Core feature**: Dual-layer architecture (batch analysis + real-time assistance)

## Key Features

- **Automatic data collection** — Real-time collection of prompts, tool usage logs, and error logs via 8 hooks
- **AI pattern analysis** — Detect repetitive patterns (tool sequences, error patterns, prompt styles) via Claude headless mode
- **Error KB vector search** — Embed normalized error patterns into 384-dimensional vectors for similarity search
- **Automatic skill matching** — Match user prompts to existing skills using vector similarity for real-time recommendations
- **Custom suggestion generation** — Automatically generate custom skills, CLAUDE.md rules, and hook workflows from detected patterns

## Architecture

### Dual-Layer System

```
┌─────────────────────────────────────────────────────┐
│           Claude Code Session                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Real-time Assistance - Within Session]           │
│  ┌─────────────────────────────────────────────┐   │
│  │ • Error KB vector search                    │   │
│  │ • Skill matching (prompt → best skill)      │   │
│  │ • Subagent error pattern injection          │   │
│  │ • Per-file error history display            │   │
│  └─────────────────────────────────────────────┘   │
│                    ↓                                 │
│  [8 Hook Event Collection]                         │
│  UserPromptSubmit → PostToolUse → SessionEnd      │
│                                                     │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  [Batch Analysis - Between Sessions]                │
│  ┌─────────────────────────────────────────────┐   │
│  │ • AI pattern analysis (headless mode)      │   │
│  │ • Custom skill suggestions                  │   │
│  │ • CLAUDE.md rule suggestions                │   │
│  │ • Hook workflow suggestions                 │   │
│  │ • Batch embeddings (384-dim vectors)        │   │
│  └─────────────────────────────────────────────┘   │
│                    ↓                                 │
│  [Save suggestions → Cache injection at SessionStart]│
└─────────────────────────────────────────────────────┘
```

### Hook Event Summary

| Event | Hook Script | Timeout | Purpose |
|-------|-------------|---------|---------|
| `UserPromptSubmit` | prompt-logger.mjs | 5s | Prompt collection + skill matching |
| `PostToolUse` | tool-logger.mjs | 5s | Tool usage + resolution detection |
| `PostToolUseFailure` | error-logger.mjs | 5s | Error collection + KB search |
| `PreToolUse` | pre-tool-guide.mjs | 5s | Per-file error history display |
| `SubagentStart` | subagent-context.mjs | 5s | Error pattern + AI rule injection |
| `SubagentStop` | subagent-tracker.mjs | 5s | Agent performance tracking |
| `SessionEnd` | session-summary.mjs | 10s | Summary + AI analysis trigger + batch embeddings |
| `SessionStart` | session-analyzer.mjs | 10s | Cache injection + embedding daemon start |

## Quick Start

### Prerequisites

- **Node.js >= 18** (v22 recommended; v24 has native build compatibility issues)
- **MacOS / Linux** (Windows requires WSL2)
- **claude CLI** installed (verify with `claude --version`)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/JakeB-5/self-generation.git
cd self-generation

# 2. Install dependencies
npm install

# 3. System installation (register hooks, create directories)
node bin/install.mjs
```

### Verification

```bash
# Run all tests (251 tests)
npm test

# If errors occur, fully remove and reinstall
node bin/install.mjs --uninstall --purge
node bin/install.mjs
```

## Usage

### Automatic Analysis (Hook-Based)

After installation, simply use Claude Code as usual. All analysis runs automatically:

1. **During session** — 8 hooks automatically collect prompts, tool usage, and errors
2. **At session end** — `SessionEnd` hook triggers AI pattern analysis in the background
3. **At next session start** — `SessionStart` hook automatically injects analysis results and suggestions

Data accumulates and suggestions are generated simply by using sessions, with no manual intervention required.

### Manual Analysis (CLI)

You can also manually trigger analysis with specific conditions:

```bash
# Default: analyze events from the last 30 days
node bin/analyze.mjs

# Analyze specific time period
node bin/analyze.mjs --days 60

# Analyze specific project only
node bin/analyze.mjs --project my-project

# Filter by specific project path
node bin/analyze.mjs --project-path /path/to/project
```

Output: Numbered list of suggestions for each detected pattern

### Applying Suggestions

```bash
# Preview suggestion #3 (does not auto-apply)
node bin/apply.mjs 3

# Apply suggestion #3 to project CLAUDE.md
node bin/apply.mjs 3 --apply

# Apply suggestion #3 to global ~/.claude/CLAUDE.md (--global)
node bin/apply.mjs 3 --global --apply

# Apply to specific project only
node bin/apply.mjs 3 --project my-project --apply
```

### Dismissing Suggestions

```bash
# Dismiss suggestion #3 (records feedback)
node bin/dismiss.mjs suggestion-id-3
```

Dismissed suggestions are excluded from future analysis.

## Output Types

Self-Generation generates three types of suggestions based on detected patterns.

| Output | Generated When | Saved To | Example |
|--------|---------------|----------|---------|
| **Custom Skills** | Repetitive tool sequences detected | `~/.claude/commands/*.md` | "Data Analysis" skill (pandas-related tools) |
| **CLAUDE.md Rules** | Repetitive instructions/patterns detected | `.claude/CLAUDE.md` (project) or `~/.claude/CLAUDE.md` (global) | "Always start with tests" rule |
| **Hook Workflows** | Repetitive event sequences detected | `~/.self-generation/hooks/auto/` | "Error occurs → Resolution" automation |

## Project Structure

```
self-generation/
├── README.md                      # This file
├── CLAUDE.md                      # Project guide
├── DESIGN.md                      # Complete system spec (SSOT)
├── package.json                   # Dependencies
├── bin/
│   ├── install.mjs               # Install/uninstall/init
│   ├── analyze.mjs               # Run AI analysis
│   ├── apply.mjs                 # Apply suggestions
│   └── dismiss.mjs               # Dismiss suggestions
├── lib/
│   ├── db.mjs                    # SQLite DB management
│   ├── ai-analyzer.mjs           # Claude headless mode wrapper
│   ├── error-kb.mjs              # Error KB vector search
│   ├── skill-matcher.mjs         # Skill matching
│   ├── feedback-tracker.mjs      # Feedback tracking
│   ├── embedding-server.mjs      # Embedding daemon
│   ├── embedding-client.mjs      # Daemon client
│   └── batch-embeddings.mjs      # Batch embeddings
├── hooks/
│   ├── prompt-logger.mjs
│   ├── tool-logger.mjs
│   ├── error-logger.mjs
│   ├── pre-tool-guide.mjs
│   ├── subagent-context.mjs
│   ├── subagent-tracker.mjs
│   ├── session-summary.mjs
│   └── session-analyzer.mjs
├── .sdd/
│   ├── constitution.md           # Project principles
│   ├── domains.yml               # Domain structure
│   └── specs/                    # 19 SDD specs
└── tests/
    └── *.test.mjs                # 251 tests (47 suites)
```

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | Node.js | >= 18 | ES Modules (`.mjs`) |
| **Storage** | SQLite | built-in | Local DB |
| **Storage Extension** | sqlite-vec | ^0.1.0 | Vector similarity search (384-dim) |
| **SQLite Binding** | better-sqlite3 | ^11.0.0 | Node.js ↔ SQLite |
| **Embeddings** | @xenova/transformers | ^2.17.0 | paraphrase-multilingual-MiniLM-L12-v2 (384-dim, offline) |
| **Analysis** | claude CLI | latest | Claude headless mode (AI pattern analysis) |
| **Hook System** | Claude Code Hooks API | built-in | `.claude/settings.json` |

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific suite only
node --test tests/db.test.mjs
```

Test coverage: 80%+ (SDD requirement)

### SDD Workflow

This project follows Spec-Driven Development (SDD).

```
Write spec (.sdd/specs/<domain>/<feature>/spec.md)
    ↓
Write tests (tests/*.test.mjs)
    ↓
Implement (bin/*.mjs, lib/*.mjs, hooks/*.mjs)
    ↓
Architect verification (DESIGN.md consistency)
    ↓
Merge
```

All changes require a spec document with RFC 2119 keywords (SHALL, SHOULD, MAY).

## Architectural Principles

Self-Generation's implementation is based on four core principles:

1. **Non-blocking hooks** — All hooks do not block Claude Code sessions (exit code 0)
2. **Global-first, project filtering** — Single SQLite DB filtered by project_path
3. **Privacy** — All data stored locally only (`~/.self-generation/`)
4. **Minimal dependencies** — Exactly 3 npm packages used (`better-sqlite3`, `sqlite-vec`, `@xenova/transformers`)

See [`.sdd/constitution.md`](.sdd/constitution.md) for detailed principles.

## Reference Documents

- **`DESIGN.md`** — Complete system spec (Single Source of Truth, 3869 lines)
- **`CLAUDE.md`** — Project guide and build commands
- **`.sdd/constitution.md`** — Project principles (v2.1.0)
- **`.sdd/specs/`** — 5 domains, 19 detailed specs

## License

MIT
