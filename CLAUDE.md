# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-Generation is a **prompt pattern analysis and auto-improvement system** for Claude Code. It collects user prompts, tool usage, and errors via Claude Code Hooks API, analyzes patterns using `claude --print` AI agent, and automatically suggests custom skills, CLAUDE.md directives, and hook workflows.

**Target environment**: Vanilla Claude Code (no plugins/OMC required)

**Current status**: Design phase only — `DESIGN.md` (v8, SQLite+Vector) is the complete implementation spec. No source code has been implemented yet. All code in DESIGN.md is the reference implementation to follow.

## Tech Stack

- **Runtime**: Node.js >= 18, ES Modules (`.mjs`)
- **Storage**: SQLite (`better-sqlite3`) + `sqlite-vec` (vector extension), 단일 DB 파일 (`self-gen.db`)
- **Analysis**: `claude --print` for semantic pattern analysis
- **Embedding**: `@xenova/transformers` + `paraphrase-multilingual-MiniLM-L12-v2` (384차원, 오프라인)
- **Hook system**: Claude Code Hooks API (registered in `~/.claude/settings.json`)
- **Dependencies**: `better-sqlite3`, `sqlite-vec`, `@xenova/transformers` — 최소 외부 패키지 3개

## Architecture

### Dual-layer System

| Layer | Timing | Purpose |
|-------|--------|---------|
| Batch analysis | Between sessions (SessionEnd → SessionStart) | Long-term pattern detection, skill/rule generation |
| Real-time assistance | Within session | Error KB lookup, skill matching, session context |

### File System Layout (planned at `~/.self-generation/`)

```
~/.self-generation/
├── config.json                    # System settings
├── data/
│   └── self-gen.db                # SQLite DB (events, error_kb, feedback, analysis_cache, skill_embeddings)
├── hooks/                         # 6 hook scripts (Claude Code events)
│   ├── prompt-logger.mjs          # UserPromptSubmit: collect + skill detection
│   ├── tool-logger.mjs            # PostToolUse: tool usage + resolution detection
│   ├── error-logger.mjs           # PostToolUseFailure: collect + error KB search
│   ├── subagent-tracker.mjs       # SubagentStop: performance tracking
│   ├── session-summary.mjs        # SessionEnd: summary + AI analysis trigger + batch embedding
│   └── session-analyzer.mjs       # SessionStart: cache injection + context
├── lib/                           # 8 utility modules
│   ├── db.mjs                     # SQLite DB connection, CRUD, vector search utilities
│   ├── ai-analyzer.mjs            # claude --print wrapper + cache management
│   ├── error-kb.mjs               # Error KB vector search/record
│   ├── skill-matcher.mjs          # Prompt-to-skill vector matching
│   ├── feedback-tracker.mjs       # Feedback tracking
│   ├── embedding-server.mjs       # Embedding daemon (Transformers.js model)
│   ├── embedding-client.mjs       # Embedding daemon client (Unix socket)
│   └── batch-embeddings.mjs       # Detached batch embedding processor
├── prompts/
│   └── analyze.md                 # AI analysis prompt template
└── bin/                           # 3 CLI tools
    ├── analyze.mjs                # On-demand AI analysis
    ├── apply.mjs                  # Apply suggestions
    └── dismiss.mjs                # Record suggestion dismissal
```

### Key Design Principles

- **Global-first, project-filtered**: All events go to a single `events` table with `project` and `project_path` fields for SQL filtering
- **Non-blocking hooks**: All hooks exit 0 quickly (timeout: 2s for collection, 5s for analysis)
- **Schema versioned**: All DB entries include `v: 1` field
- **Privacy-conscious**: Only first word of Bash commands stored; full args not logged
- **Vector search**: sqlite-vec 확장으로 에러 KB 및 스킬 매칭에 384차원 벡터 유사도 검색 지원
- **WAL mode**: Write-Ahead Logging으로 훅 간 동시 DB 접근 지원

### Implementation Phases

1. **Phase 1 — Data Collection**: Hook scripts that log events to SQLite `events` table
2. **Phase 2 — AI Pattern Analysis**: `claude --print` batch analysis + cache
3. **Phase 3 — Suggestion Engine**: CLI tools to apply/dismiss AI-generated suggestions
4. **Phase 4 — Feedback Loop**: Track acceptance rates, feed back into AI analysis
5. **Phase 5 — Real-time Assistance**: Error KB, skill matching, subagent tracking, session context

### Three Output Types

| Output | When | Target |
|--------|------|--------|
| Custom skills | Repeated task patterns detected | `.claude/commands/*.md` |
| CLAUDE.md directives | Repeated instructions detected | `CLAUDE.md` or `~/.claude/CLAUDE.md` |
| Hook workflows | Repeated tool sequences detected | `.claude/settings.json` hooks |

## Key Reference Documents

- **`DESIGN.md`** — Complete system spec with all code (the source of truth for implementation)
- **`RESULT.md`** — Expected outcomes analysis (v7, 89.2% average achievability)
- **`REFERENCE-HOOK-SYSTEM.md`** — External hook system reference (36 hooks flow diagram)

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
- All features require a spec document first (in `.sdd/specs/`)
- Specs use RFC 2119 keywords (SHALL, SHOULD, etc.)
- All requirements include GIVEN-WHEN-THEN scenarios
- Test coverage target: 80%+

## Claude Code Hooks API Reference

The system uses 6 of 12 available hook events. Key stdin fields per event:

| Event | Key stdin fields |
|-------|-----------------|
| `UserPromptSubmit` | `prompt`, `session_id`, `cwd` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `session_id`, `cwd` |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `error`, `session_id`, `cwd` |
| `SubagentStop` | `agent_id`, `agent_type`, `session_id` |
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
