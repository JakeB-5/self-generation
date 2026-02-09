# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-Generation is a **prompt pattern analysis and auto-improvement system** for Claude Code. It collects user prompts, tool usage, and errors via Claude Code Hooks API, analyzes patterns using Claude in headless mode, and automatically suggests custom skills, CLAUDE.md directives, and hook workflows.

**Target environment**: Vanilla Claude Code (no plugins/OMC required)

**Current status**: Implementation complete (Phase 1-5 all done). 237 tests passing, validated by 5 domain agents + architect verification.

## Tech Stack

- **Runtime**: Node.js >= 18 (tested on v22), ES Modules (`.mjs`)
- **Storage**: SQLite (`better-sqlite3`) + `sqlite-vec` (vector extension), single DB file (`self-gen.db`), WAL mode
- **Analysis**: Claude headless mode for semantic pattern analysis (async/background only)
- **Embedding**: `@xenova/transformers` + `paraphrase-multilingual-MiniLM-L12-v2` (384-dim, offline)
- **Hook system**: Claude Code Hooks API (8 events registered in `~/.claude/settings.json`)
- **Dependencies**: `better-sqlite3`, `sqlite-vec`, `@xenova/transformers` — exactly 3 external packages (no more allowed)

## Build & Test

```bash
# Node 22 required (v24 breaks better-sqlite3 native build)
nvm use 22

# Install dependencies
npm install

# Run all tests (251 tests, 47 suites)
npm test

# Install system (registers hooks, creates directories, installs deps)
node bin/install.mjs

# Uninstall (remove hooks, keep data)
node bin/install.mjs --uninstall

# Full purge (remove hooks + all data)
node bin/install.mjs --uninstall --purge

# Run AI analysis
node bin/analyze.mjs [--days 30] [--project name] [--project-path path]

# Apply suggestion
node bin/apply.mjs <number> [--global] [--project <name>] [--apply]

# Dismiss suggestion
node bin/dismiss.mjs <suggestion-id>
```

## Architecture

### Dual-layer System

| Layer | Timing | Purpose |
|-------|--------|---------|
| Batch analysis | Between sessions (SessionEnd → SessionStart) | Long-term pattern detection, skill/rule generation |
| Real-time assistance | Within session | Error KB lookup, skill matching, session context |

### File System Layout (`~/.self-generation/`)

```
~/.self-generation/
├── config.json                    # System settings (enabled, collectPromptText, retentionDays, analysisModel)
├── data/
│   └── self-gen.db                # SQLite DB (events, error_kb, feedback, analysis_cache, skill_embeddings)
├── hooks/                         # 8 hook scripts (Claude Code events)
│   ├── prompt-logger.mjs          # UserPromptSubmit: collect + skill detection (2s timeout)
│   ├── tool-logger.mjs            # PostToolUse: tool usage + resolution detection
│   ├── error-logger.mjs           # PostToolUseFailure: collect + error KB search
│   ├── pre-tool-guide.mjs         # PreToolUse (Edit|Write|Bash|Task): file error history
│   ├── subagent-context.mjs       # SubagentStart: inject error patterns + AI rules
│   ├── subagent-tracker.mjs       # SubagentStop: performance tracking
│   ├── session-summary.mjs        # SessionEnd: summary + AI analysis trigger + batch embedding
│   └── session-analyzer.mjs       # SessionStart: cache injection + context + daemon start
├── hooks/auto/                    # Auto-generated hook workflows (created dynamically by apply.mjs)
├── lib/                           # 8 utility modules
│   ├── db.mjs                     # SQLite DB connection, CRUD, vector search, config, privacy utilities
│   ├── ai-analyzer.mjs            # Claude headless mode wrapper + cache management
│   ├── error-kb.mjs               # Error KB: normalize, vector search (3-stage), record resolution
│   ├── skill-matcher.mjs          # Prompt-to-skill: vector + keyword fallback matching
│   ├── feedback-tracker.mjs       # Feedback recording, usage rates, stale skill detection
│   ├── embedding-server.mjs       # Embedding daemon (Unix socket, Transformers.js, 30min idle timeout)
│   ├── embedding-client.mjs       # Embedding daemon client (auto-start, 10s timeout)
│   └── batch-embeddings.mjs       # Detached batch embedding processor (10s startup delay)
├── prompts/
│   └── analyze.md                 # AI analysis prompt template
└── bin/                           # 4 CLI tools
    ├── install.mjs                # System install/uninstall/purge
    ├── analyze.mjs                # On-demand AI analysis
    ├── apply.mjs                  # Apply suggestions (skill/rule/hook)
    └── dismiss.mjs                # Record suggestion dismissal
```

### Key Design Principles

- **Global-first, project-filtered**: All events go to a single `events` table with `project` and `project_path` fields for SQL filtering
- **Non-blocking hooks**: All hooks exit 0 on any error (try-catch + `process.exit(0)`). Timeouts: 5s for collection hooks, 10s for session hooks
- **Schema versioned**: All DB entries include `v: 1` field
- **Privacy-conscious**: Bash commands store first word only; `<private>` tags stripped; error messages normalized (paths→`<PATH>`, numbers→`<N>`, strings→`<STR>`)
- **Vector search**: sqlite-vec extension for error KB and skill matching with 384-dim cosine similarity
- **WAL mode**: Write-Ahead Logging for concurrent hook DB access
- **No sync AI in hooks**: Claude headless mode is NEVER invoked synchronously in hooks; batch analysis uses detached `spawn` only

### DB Schema (5 tables + 2 vec0 virtual tables + FTS5)

| Table | Purpose |
|-------|---------|
| `events` | All hook events (prompts, tool usage, errors, sessions, skills) |
| `error_kb` | Error knowledge base with normalized patterns + resolutions |
| `feedback` | Suggestion acceptance/rejection tracking |
| `analysis_cache` | AI analysis results cache (TTL-based) |
| `skill_embeddings` | Skill metadata + embedding vectors |
| `vec_error_kb` | Vector index for error KB similarity search |
| `vec_skill_embeddings` | Vector index for skill matching |
| `events_fts` | Full-text search index on events |

### Three Output Types

| Output | When | Target |
|--------|------|--------|
| Custom skills | Repeated task patterns detected | `.claude/commands/*.md` |
| CLAUDE.md directives | Repeated instructions detected | `.claude/CLAUDE.md` (project) or `~/.claude/CLAUDE.md` (global) |
| Hook workflows | Repeated tool sequences detected | `~/.self-generation/hooks/auto/` |

## Key Reference Documents

- **`DESIGN.md`** — Complete system spec v9 with all reference code (Single Source of Truth)
- **`RESULT.md`** — Expected outcomes analysis (v7, 89.2% average achievability)
- **`.sdd/constitution.md`** — Project principles and constraints (v2.1.0)
- **`.sdd/specs/`** — 19 spec.md files across 5 domains (infra, data-collection, ai-analysis, suggestion-engine, realtime-assist)

## Conventions

### Language Policy

- User communication: Korean
- Documentation: Korean
- Code comments: English
- Git commit messages: English

### Git Commit Message Format

Uses `.gitmessage` template with SDD-style conventions:

```
<type>(<scope>): <subject>

# Spec types: spec, spec-update, spec-status, plan, tasks, constitution, sdd-config
# General types: feat, fix, docs, style, refactor, test, chore
```

### SDD (Spec-Driven Development)

This project follows Spec-Driven Development:
- All features require a spec document first (in `.sdd/specs/<domain>/<feature>/spec.md`)
- Specs use RFC 2119 keywords (SHALL, SHOULD, MAY)
- All requirements include GIVEN-WHEN-THEN scenarios
- Test coverage target: 80%+
- Constitution (`.sdd/constitution.md`) is the supreme constraint document

## Claude Code Hooks API Reference

The system uses 8 of 12 available hook events:

| Event | Hook Script | Timeout | Purpose |
|-------|------------|---------|---------|
| `UserPromptSubmit` | `prompt-logger.mjs` | 5s | Prompt collection + skill matching |
| `PostToolUse` | `tool-logger.mjs` | 5s | Tool usage + resolution detection |
| `PostToolUseFailure` | `error-logger.mjs` | 5s | Error collection + KB search |
| `PreToolUse` | `pre-tool-guide.mjs` | 5s | File error history (Edit\|Write\|Bash\|Task) |
| `SubagentStart` | `subagent-context.mjs` | 5s | Inject error patterns + AI rules |
| `SubagentStop` | `subagent-tracker.mjs` | 5s | Agent performance tracking |
| `SessionEnd` | `session-summary.mjs` | 10s | Summary + AI trigger + batch embed |
| `SessionStart` | `session-analyzer.mjs` | 10s | Cache injection + daemon start |

Hook stdin fields per event:

| Event | Key stdin fields |
|-------|-----------------|
| `UserPromptSubmit` | `prompt`, `session_id`, `cwd` |
| `PostToolUse` | `tool_name`, `tool_input`, `session_id`, `cwd` |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `error`, `session_id`, `cwd` |
| `PreToolUse` | `tool_name`, `tool_input`, `session_id`, `cwd` |
| `SubagentStart` | `agent_id`, `agent_type`, `session_id`, `cwd` |
| `SubagentStop` | `agent_id`, `agent_type`, `session_id`, `cwd` |
| `SessionEnd` | `reason`, `session_id`, `cwd` |
| `SessionStart` | `source`, `model`, `session_id`, `cwd` |

Hook stdout format for injecting context:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "EventName",
    "additionalContext": "context string injected to Claude"
  }
}
```
