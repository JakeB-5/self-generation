# Self-Generation: Prompt Pattern Analysis & Auto-Improvement System

> 사용자의 프롬프트와 응답을 수집하고 패턴을 분석하여, 반복되는 작업을 커스텀 스킬, CLAUDE.md 지침, 훅 워크플로우로 자동 개선하는 독립 시스템
>
> **대상 환경**: 바닐라 Claude Code (플러그인/OMC 없음)

---

## 목차

1. [개요](#1-개요)
2. [문제 정의](#2-문제-정의)
3. [시스템 아키텍처](#3-시스템-아키텍처)
4. [Phase 1: 데이터 수집 레이어](#4-phase-1-데이터-수집-레이어)
5. [Phase 2: AI 기반 패턴 분석 레이어](#5-phase-2-ai-기반-패턴-분석-레이어)
6. [Phase 3: 제안 적용 엔진](#6-phase-3-제안-적용-엔진)
7. [Phase 4: 피드백 루프](#7-phase-4-피드백-루프)
8. [Phase 5: 실시간 어시스턴스 레이어](#8-phase-5-실시간-어시스턴스-레이어)
9. [데이터 스키마](#9-데이터-스키마)
10. [프라이버시 및 보안](#10-프라이버시-및-보안)
11. [구현 로드맵](#11-구현-로드맵)

---

## 1. 개요

### 배경

Claude Code를 사용하면서 사용자는 무의식적으로 동일한 패턴의 프롬프트를 반복하고, 비슷한 도구 시퀀스를 거치며, 매 세션마다 같은 지시를 되풀이한다. 이러한 반복은 시간 낭비일 뿐 아니라 토큰 비용 증가로 이어진다.

### 목표

| 목표 | 설명 |
|------|------|
| 자동 수집 | 프롬프트, 도구 사용 패턴, 세션 요약을 자동으로 기록 |
| 패턴 감지 | 반복되는 프롬프트, 도구 시퀀스, 오류 패턴을 식별 |
| 개선 제안 | 커스텀 스킬 생성, CLAUDE.md 지침 추가, 훅 워크플로우 등록을 제안 |
| 자기 개선 | 제안의 채택률을 추적하여 제안 품질 자체를 개선 |

### 제안 유형 3가지

```
┌──────────────────────────────────────────────────────────────┐
│                     패턴 감지 결과                              │
├────────────────────┬────────────────────┬────────────────────┤
│  커스텀 스킬 생성    │   CLAUDE.md 지침    │   훅 워크플로우      │
│                    │                    │                    │
│ 반복 작업을         │ 매번 말하는         │ 항상 같은 순서로     │
│ 자동화하는          │ 선호사항을          │ 실행하는 도구 패턴을  │
│ 재사용 스킬         │ 영구 지침으로       │ 자동 훅으로         │
└────────────────────┴────────────────────┴────────────────────┘
```

### 기술 스택 & 전제조건

| 항목 | 선택 | 이유 |
|------|------|------|
| 런타임 | Node.js (>=18) | Claude Code가 이미 Node.js 환경 |
| 저장소 | SQLite + sqlite-vec | WAL 모드로 동시성 안전, 벡터 유사도 검색 지원 |
| DB 바인딩 | `better-sqlite3` | 동기 API, 네이티브 성능, Node.js 최적 |
| 벡터 확장 | `sqlite-vec` | SQLite 벡터 유사도 검색 확장 (float[384]) |
| 임베딩 모델 | `@xenova/transformers` + `paraphrase-multilingual-MiniLM-L12-v2` | 384차원 다국어 임베딩, 오프라인 실행, 2.4ms/건 |
| 훅 시스템 | Claude Code Hooks API | 바닐라 Claude Code 내장 기능 |
| 분석 | `claude --print` (AI 에이전트) | 패턴 분석 + 제안 생성 (임베딩은 Transformers.js) |
| 설정 | JSON | Claude Code settings.json과 동일 패턴 |

> **의존성 정책 변경**: 초기 설계의 "외부 npm 패키지 제로" 정책에서 "최소 의존성" 정책으로 전환.
> `better-sqlite3`와 `sqlite-vec` 2개 패키지만 사용하며, JSONL 대비 인덱스 기반 쿼리 성능,
> WAL 모드 동시성, 벡터 유사도 검색 등의 이점이 의존성 추가를 정당화한다.

---

## 2. 문제 정의

### 사용자가 겪는 반복 패턴 예시

**A) 반복 프롬프트**
```
세션 1: "TypeScript 프로젝트 초기화해줘. eslint, prettier 포함해서."
세션 5: "새 TS 프로젝트 만들어줘. 린터 설정도."
세션 9: "타입스크립트 프로젝트 셋업해줘."
→ 제안: `/ts-init` 커스텀 스킬 생성
```

**B) 반복 지시**
```
세션 1: "이 프로젝트는 pnpm 사용해"
세션 2: "pnpm으로 설치해"
세션 3: "npm 말고 pnpm 써"
→ 제안: CLAUDE.md에 "이 프로젝트는 pnpm을 패키지 매니저로 사용합니다" 추가
```

**C) 반복 워크플로우**
```
매번: Grep → Read → Edit → Bash(test) 순서 반복
→ 제안: PreToolUse 훅으로 "테스트 먼저 실행" 리마인더 자동 주입
```

**D) 반복 오류 대응**
```
"ESLint 에러 무시하지 말고 고쳐" (3회 반복)
→ 제안: CLAUDE.md에 "린트 에러는 무시하지 않고 반드시 수정합니다" 추가
```

---

## 3. 시스템 아키텍처

### Claude Code Hooks API 기반

이 시스템은 바닐라 Claude Code의 Hooks API만을 사용한다. 훅은 `~/.claude/settings.json` 또는 프로젝트별 `.claude/settings.json`에 등록한다.

**사용하는 훅 이벤트:**

| 이벤트 | 용도 | 블로킹 |
|--------|------|--------|
| `UserPromptSubmit` | 프롬프트 수집 + 스킬 자동 감지 | No |
| `PostToolUse` | 도구 사용 기록 | No |
| `PostToolUseFailure` | 에러 기록 + 에러 KB 실시간 검색 | No |
| `SubagentStop` | 서브에이전트 성능 추적 | No |
| `SessionEnd` | 세션 요약 + AI 분석 트리거 | No |
| `SessionStart` | 캐시된 AI 분석 주입 + 이전 세션 컨텍스트 주입 | No |

### 전체 구조

```
┌──────────────────────────────────────────────────────────────────┐
│                      Claude Code Session                         │
│                                                                  │
│  ┌─── 실시간 어시스턴스 (Phase 5) ───────────────────────────┐   │
│  │                                                           │   │
│  │  User Prompt ──→ [UserPromptSubmit] ──┬→ self-gen.db      │   │
│  │                                       └→ 스킬 자동 감지    │   │
│  │                                          (벡터 스킬 매칭)  │   │
│  │                                                           │   │
│  │  Tool Error  ──→ [PostToolUseFailure] ─┬→ self-gen.db     │   │
│  │                                        └→ 에러 KB 검색    │   │
│  │                                           (벡터 유사도)    │   │
│  │                                                           │   │
│  │  Subagent   ──→ [SubagentStop] ──→ 성능 메트릭 기록       │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─── 배치 분석 (Phase 2) ───────────────────────────────────┐   │
│  │                                                           │   │
│  │  Tool Usage  ──→ [PostToolUse] ──→ self-gen.db             │   │
│  │                                                           │   │
│  │  Session End ──→ [SessionEnd] ──┬→ self-gen.db            │   │
│  │                                 ├→ claude --print 분석    │   │
│  │                                 │   (비동기 백그라운드)     │   │
│  │                                 │        │                │   │
│  │                                 │        ▼                │   │
│  │                                 │  analysis_cache 테이블   │   │
│  │                                 └→ 배치 임베딩 생성 (Transformers.js) │   │
│  │                                                           │   │
│  │  Session Start ──→ [SessionStart] ──→ DB 캐시 주입        │   │
│  │                                  ──→ 이전 세션 컨텍스트    │   │
│  │                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ 사용자 승인  │
                    └──────┬──────┘
                           │
               ┌───────────┼───────────┐
               │           │           │
       ┌───────▼────┐ ┌───▼─────┐ ┌──▼──────────┐
       │.claude/     │ │CLAUDE.md│ │.claude/      │
       │commands/    │ │ 수정    │ │settings.json │
       │(스킬)       │ │         │ │(훅 등록)     │
       └────────────┘ └─────────┘ └─────────────┘
```

### 컴포넌트 요약

| 컴포넌트 | 역할 | 위치 |
|----------|------|------|
| Prompt Logger | 프롬프트/도구/에러 이벤트 수집 | Hook 스크립트 |
| AI Analyzer | `claude --print`로 패턴 분석 + 제안 생성 | SessionEnd 훅 (비동기) |
| Analysis Cache | AI 분석 결과 저장, SessionStart에서 주입 | `analysis_cache` 테이블 (SQLite) |
| Error KB | 에러 해결 이력 저장 + 벡터 유사도 검색 | `error_kb` 테이블 (SQLite + sqlite-vec) |
| Skill Matcher | 기존 스킬과 프롬프트 벡터 매칭 | `skill_embeddings` 테이블 + UserPromptSubmit 훅 |
| Subagent Tracker | 서브에이전트 성능 메트릭 추적 | SubagentStop 훅 |
| Feedback Tracker | 제안 채택/거부 추적 | `feedback` 테이블 (SQLite) |

### 파일 시스템 구조

모든 데이터와 스크립트는 `~/.self-generation/`에 전역으로 관리된다.
프로젝트별 분리가 아닌 **하나의 DB에 모든 세션을 기록**하고, 각 이벤트에 `project` 필드를 포함하여 프로젝트별 필터링이 가능하다.

```
~/.self-generation/                ← 전역 시스템 루트
├── config.json                    ← 시스템 설정
├── data/
│   └── self-gen.db                ← SQLite DB (WAL 모드, 모든 데이터 통합)
│       ├── events                 ← 전역 이벤트 로그 (prompt, tool_use, tool_error, ...)
│       ├── error_kb               ← 에러 해결 이력 + 벡터 임베딩
│       ├── feedback               ← 제안 채택/거부 기록
│       ├── analysis_cache         ← AI 분석 결과 캐시
│       └── skill_embeddings       ← 스킬 벡터 임베딩
├── hooks/
│   ├── prompt-logger.mjs          ← UserPromptSubmit 훅 (수집 + 스킬 자동 감지)
│   ├── tool-logger.mjs            ← PostToolUse 훅
│   ├── error-logger.mjs           ← PostToolUseFailure 훅 (수집 + 에러 KB 검색)
│   ├── subagent-tracker.mjs       ← SubagentStop 훅 (성능 추적)
│   ├── session-summary.mjs        ← SessionEnd 훅 (요약 + AI 분석 트리거)
│   ├── session-analyzer.mjs       ← SessionStart 훅 (캐시 주입 + 세션 컨텍스트)
│   ├── pre-tool-guide.mjs         ← PreToolUse 훅 (사전 예방 가이드, v7)
│   ├── subagent-context.mjs       ← SubagentStart 훅 (컨텍스트 주입, v7)
│   └── auto/                      ← AI가 생성한 워크플로우 훅 (v7)
├── lib/
│   ├── db.mjs                     ← SQLite DB 연결/쿼리 유틸 (WAL, sqlite-vec)
│   ├── ai-analyzer.mjs            ← claude --print 기반 AI 분석 실행
│   ├── error-kb.mjs               ← 에러 KB 벡터 검색/기록
│   ├── skill-matcher.mjs          ← 벡터 기반 스킬-프롬프트 매칭
│   └── feedback-tracker.mjs       ← 피드백 추적
├── prompts/
│   └── analyze.md                 ← AI 분석 프롬프트 템플릿
└── bin/
    ├── analyze.mjs                ← CLI 분석 도구 (claude --print 호출)
    ├── apply.mjs                  ← 제안 적용 도구
    └── dismiss.mjs                ← 제안 거부 기록 도구

~/.claude/
├── settings.json                  ← 전역 훅 등록 (모든 프로젝트에 적용)
├── commands/                      ← 전역 커스텀 스킬
│   ├── ts-init.md                 ← 자동 생성된 스킬 예시
│   └── ...
└── CLAUDE.md                      ← 글로벌 지침

<project>/.claude/
├── commands/                      ← 프로젝트 특화 스킬 (선택)
└── CLAUDE.md                      ← 프로젝트별 지침 (선택)
```

**설계 원칙: 전역 우선, 프로젝트 필터링**
- 수집: 모든 프로젝트의 이벤트가 하나의 `self-gen.db` → `events` 테이블에 기록
- 각 이벤트에 `project`, `project_path` 필드 포함 (인덱스 기반 빠른 필터링)
- 분석: 전역 패턴 (크로스-프로젝트) + 프로젝트별 패턴 모두 감지
- 제안: 범용 패턴 → `~/.claude/` 전역 적용, 프로젝트 특화 → `<project>/.claude/` 적용

---

## 4. Phase 1: 데이터 수집 레이어

### 4.1 훅 등록

`~/.claude/settings.json`에 추가:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/.self-generation/hooks/prompt-logger.mjs"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/.self-generation/hooks/tool-logger.mjs"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/.self-generation/hooks/error-logger.mjs"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/.self-generation/hooks/session-summary.mjs"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/.self-generation/hooks/session-analyzer.mjs"
          }
        ]
      }
    ]
  }
}
```

**설계 원칙:**
- 모든 수집 훅은 **non-blocking** (exit code 0, 빠른 완료)
- 훅 실패가 Claude Code 세션에 영향을 주지 않음

#### API 필드 검증 결과

Claude Code 공식 문서 대조를 통해 설계에 사용된 모든 API 필드를 검증했다:

| 항목 | 설계 문서 | 실제 API | 판정 |
|------|----------|---------|------|
| `SessionEnd` 이벤트 | 사용 | 12개 이벤트 중 하나로 확인 | OK |
| `session_id` 필드명 | `input.session_id` | snake_case 확인 | OK |
| `cwd` 필드 | 사용 | 모든 이벤트에 포함 | OK |
| `prompt` 필드 | `input.prompt` | UserPromptSubmit에 확인 | OK |
| `tool_name`, `tool_input` | 사용 | PostToolUse/Failure에 확인 | OK |
| `error` 필드 | `input.error` | PostToolUseFailure에 확인 | OK |
| `additionalContext` 출력 | `hookSpecificOutput.additionalContext` | 정확한 형식 확인 | OK |
| `tool_response` 필드 | v7에서 활용 | PostToolUse에 존재 | OK |
| SessionEnd `reason` 필드 | v7 P8에서 활용 | 존재 (clear, logout, ...) | OK |
| SessionStart `source` 필드 | v7 P7에서 활용 | 존재 (startup, resume, ...) | OK |

### 4.2 공통 유틸: SQLite DB 모듈

> **설계 변경 (v8)**: `lib/log-writer.mjs` (JSONL 기반)를 `lib/db.mjs` (SQLite + sqlite-vec)로 교체.
> 인덱스 기반 쿼리, WAL 모드 동시성, 벡터 유사도 검색을 지원한다.

```javascript
// ~/.self-generation/lib/db.mjs
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { mkdirSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const GLOBAL_DIR = join(process.env.HOME, '.self-generation');
const DATA_DIR = join(GLOBAL_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'self-gen.db');
const RETENTION_DAYS = 90;

let _db = null;

/**
 * DB 연결 싱글턴 (WAL 모드, sqlite-vec 로드)
 * 모든 훅과 모듈에서 getDb()로 동일 연결 공유
 */
export function getDb() {
  if (_db) return _db;

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');

  // sqlite-vec 확장 로드
  sqliteVec.load(_db);

  initDb(_db);
  return _db;
}

/**
 * DB 스키마 초기화 (CREATE IF NOT EXISTS)
 */
export function initDb(db) {
  db.exec(`
    -- Events table (replaces prompt-log.jsonl)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      v INTEGER DEFAULT 1,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      session_id TEXT NOT NULL,
      project TEXT,
      project_path TEXT,
      data JSON NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_events_project_type ON events(project_path, type, ts);
    CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);

    -- Error KB table (replaces error-kb.jsonl) with vector column
    CREATE TABLE IF NOT EXISTS error_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      error_normalized TEXT NOT NULL,
      error_raw TEXT,
      resolution TEXT,
      resolved_by TEXT,
      tool_sequence TEXT,
      use_count INTEGER DEFAULT 0,
      last_used TEXT,
      embedding BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_error_kb_error ON error_kb(error_normalized);

    -- Feedback table (replaces feedback.jsonl)
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      v INTEGER DEFAULT 1,
      ts TEXT NOT NULL,
      suggestion_id TEXT NOT NULL,
      action TEXT NOT NULL,
      suggestion_type TEXT,
      summary TEXT
    );

    -- Analysis cache table (replaces analysis-cache.json)
    CREATE TABLE IF NOT EXISTS analysis_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      project TEXT,
      days INTEGER,
      analysis JSON NOT NULL
    );

    -- Skill embeddings table (for vector skill matching)
    CREATE TABLE IF NOT EXISTS skill_embeddings (
      name TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      description TEXT,
      keywords TEXT,
      updated_at TEXT NOT NULL,
      embedding BLOB
    );
  `);
}

export function getProjectName(cwd) {
  // /Users/sungwon/projects/my-app → my-app (표시용)
  return cwd ? cwd.split('/').filter(Boolean).pop() : 'unknown';
}

// 주의: project(디렉토리명)는 표시용, project_path(전체 경로)가 정규 식별자
// 동명 프로젝트 충돌 방지를 위해 필터링은 project_path 기반 권장

/**
 * 이벤트 삽입 (replaces appendEntry)
 * 훅에서 수집한 이벤트를 events 테이블에 기록
 */
export function insertEvent(entry) {
  const db = getDb();
  const { v = 1, type, ts, sessionId, project, projectPath, ...rest } = entry;
  db.prepare(`
    INSERT INTO events (v, type, ts, session_id, project, project_path, data)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(v, type, ts, sessionId, project, projectPath, JSON.stringify(rest));
}

/**
 * 이벤트 쿼리 (replaces readEntries)
 * SQL 인덱스 기반 필터링으로 JSONL 순차 스캔 대비 대폭 성능 향상
 */
export function queryEvents(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (filters.type) {
    conditions.push('type = ?');
    params.push(filters.type);
  }
  if (filters.sessionId) {
    conditions.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.projectPath) {
    conditions.push('project_path = ?');
    params.push(filters.projectPath);
  }
  if (filters.project) {
    conditions.push('project = ?');
    params.push(filters.project);
  }
  if (filters.since) {
    conditions.push('ts >= ?');
    params.push(filters.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ? `LIMIT ${Number(filters.limit)}` : '';

  const rows = db.prepare(`
    SELECT * FROM events ${where} ORDER BY ts DESC ${limit}
  `).all(...params);

  // Reconstruct flat entry format for backward compatibility
  return rows.map(row => ({
    v: row.v,
    type: row.type,
    ts: row.ts,
    sessionId: row.session_id,
    project: row.project,
    projectPath: row.project_path,
    ...JSON.parse(row.data)
  }));
}

/**
 * 세션별 이벤트 조회 (편의 함수)
 */
export function getSessionEvents(sessionId, limit) {
  return queryEvents({ sessionId, limit });
}

/**
 * 임베딩 생성 (배치)
 * Transformers.js의 paraphrase-multilingual-MiniLM-L12-v2 모델 사용
 * - 384차원, 다국어(한국어 포함), 오프라인 실행
 * - 프리픽스 불필요 (paraphrase 모델 특성)
 * - 모델 캐시: ~/.self-generation/models/
 */
let _pipeline = null;

async function getEmbeddingPipeline() {
  if (!_pipeline) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = join(homedir(), '.self-generation', 'models');
    _pipeline = await pipeline('feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  }
  return _pipeline;
}

export async function generateEmbeddings(texts) {
  if (!texts || texts.length === 0) return [];

  try {
    const extractor = await getEmbeddingPipeline();
    const results = [];
    for (const text of texts) {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data));
    }
    return results;
  } catch {
    return []; // Return empty on model load error
  }
}

/**
 * 벡터 유사도 검색
 * sqlite-vec의 vec_distance_cosine으로 코사인 거리 기반 검색
 */
export function vectorSearch(table, embeddingColumn, queryEmbedding, limit = 5) {
  const db = getDb();
  const embeddingBlob = new Float32Array(queryEmbedding);

  return db.prepare(`
    SELECT *, vec_distance_cosine(${embeddingColumn}, ?) AS distance
    FROM ${table}
    WHERE ${embeddingColumn} IS NOT NULL
    ORDER BY distance ASC
    LIMIT ?
  `).all(embeddingBlob, limit);
}

export function readStdin() {
  const chunks = [];
  const fd = openSync('/dev/stdin', 'r');
  const buf = Buffer.alloc(65536);
  let n;
  while ((n = readSync(fd, buf)) > 0) {
    chunks.push(buf.slice(0, n));
  }
  closeSync(fd);
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

export function loadConfig() {
  const configPath = join(GLOBAL_DIR, 'config.json');
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

/**
 * 오래된 이벤트 삭제 (replaces rotateIfNeeded + pruneOldLogs)
 * SQLite DELETE WHERE로 보관기간 초과 데이터 정리
 */
export function pruneOldEvents(retentionDays = RETENTION_DAYS) {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
  db.prepare('DELETE FROM error_kb WHERE ts < ? AND use_count = 0').run(cutoff);
}
```

> **JSONL → SQLite 마이그레이션 요약**:
> - `appendEntry(logFile, entry)` → `insertEvent(entry)` (파일 경로 불필요)
> - `readEntries(logFile, filter)` → `queryEvents(filter)` (SQL 인덱스 기반)
> - `rotateIfNeeded()` + `pruneOldLogs()` → `pruneOldEvents()` (DELETE WHERE)
> - `getLogFile()` → 제거 (DB 경로는 `getDb()` 내부에서 관리)
> - `getSessionIndex()` / `updateSessionIndex()` → 제거 (SQL 인덱스가 대체)

### 4.3 프롬프트 수집 훅 (UserPromptSubmit)

```javascript
// ~/.self-generation/hooks/prompt-logger.mjs
import { insertEvent, getProjectName, readStdin } from '../lib/db.mjs';

try {
  const input = readStdin();

  const entry = {
    v: 1,
    type: 'prompt',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    text: input.prompt,
    charCount: input.prompt.length
  };

  insertEvent(entry);
  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

> **설계 변경 (v5)**: 키워드 추출, 인텐트 분류, 언어 감지를 수집 시점에서 제거.
> 이 작업들은 AI 분석 단계(`claude --print`)에서 의미 기반으로 수행하므로
> 수집 훅은 원본 데이터만 빠르게 기록하는 역할에 집중한다.

### 4.4 도구 사용 수집 훅 (PostToolUse)

```javascript
// ~/.self-generation/hooks/tool-logger.mjs
import { insertEvent, queryEvents, getProjectName, readStdin } from '../lib/db.mjs';
import { recordResolution } from '../lib/error-kb.mjs';

try {
  const input = readStdin();

  const entry = {
    v: 1,
    type: 'tool_use',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    tool: input.tool_name,
    meta: extractToolMeta(input.tool_name, input.tool_input),
    success: true
  };

  insertEvent(entry);

  // Resolution detection (v7 개선: 세션스코프 + 풍부한 컨텍스트 + 크로스도구)
  try {
    const sessionEntries = queryEvents({ sessionId: input.session_id })
      .sort((a, b) => new Date(a.ts) - new Date(b.ts)); // 시간순

    // 1. 동일 도구 해결 감지 (P4: 세션스코프, 5분 제한 제거)
    const sameToolErrors = sessionEntries
      .filter(e => e.type === 'tool_error' && e.tool === input.tool_name);

    if (sameToolErrors.length > 0) {
      const lastError = sameToolErrors[sameToolErrors.length - 1];

      // P11: 에러와 성공 사이의 도구 시퀀스 수집
      const errorIdx = sessionEntries.indexOf(lastError);
      const toolsBetween = sessionEntries
        .slice(errorIdx + 1)
        .filter(e => e.type === 'tool_use')
        .slice(0, 5)
        .map(e => e.tool);

      recordResolution(lastError.error, {
        tool: input.tool_name,
        sessionId: input.session_id,
        resolvedBy: 'success_after_error',
        errorRaw: lastError.errorRaw || null,
        // P11: 풍부한 해결 컨텍스트
        filePath: entry.meta?.file || null,
        toolSequence: toolsBetween,
        promptContext: sessionEntries
          .filter(e => e.type === 'prompt')
          .slice(-1)[0]?.text?.slice(0, 200) || null
      });
    }

    // 2. 크로스도구 해결 감지 (P12: 다른 도구로 해결된 에러)
    // 예: Bash(fail) → Edit(fix) → Bash(success) 패턴
    const pendingErrors = sessionEntries
      .filter(e => e.type === 'tool_error' && e.tool !== input.tool_name);

    for (const pendingError of pendingErrors) {
      // 해당 에러의 원래 도구가 이후 성공한 적 있는지 확인
      const errorIdx = sessionEntries.indexOf(pendingError);
      const laterSuccesses = sessionEntries
        .slice(errorIdx + 1)
        .filter(e => e.type === 'tool_use' && e.tool === pendingError.tool && e.success);

      if (laterSuccesses.length > 0) {
        // 이미 해결됨 - 중간에 어떤 도구가 도왔는지 기록
        const helpingTools = sessionEntries
          .slice(errorIdx + 1, sessionEntries.indexOf(laterSuccesses[0]))
          .filter(e => e.type === 'tool_use')
          .map(e => e.tool);

        if (helpingTools.includes(input.tool_name)) {
          recordResolution(pendingError.error, {
            tool: pendingError.tool,
            sessionId: input.session_id,
            resolvedBy: 'cross_tool_resolution',
            errorRaw: pendingError.errorRaw || null,
            helpingTool: input.tool_name,
            filePath: entry.meta?.file || null,
            toolSequence: helpingTools
          });
        }
      }
    }
  } catch (resolutionError) {
    // Silent fail - resolution detection is non-critical
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}

function extractToolMeta(tool, toolInput) {
  switch (tool) {
    case 'Bash':
      // 실행 커맨드의 첫 단어만 (보안: 전체 인자 저장하지 않음)
      const cmd = (toolInput.command || '').split(/\s+/)[0];
      return { command: cmd };
    case 'Read':
      return { file: toolInput.file_path };
    case 'Write':
      return { file: toolInput.file_path };
    case 'Edit':
      return { file: toolInput.file_path };
    case 'Grep':
      return { pattern: toolInput.pattern };
    case 'Glob':
      return { pattern: toolInput.pattern };
    case 'Task':
      return { agentType: toolInput.subagent_type, model: toolInput.model };
    default:
      return {};
  }
}
```

### 4.5 에러 수집 훅 (PostToolUseFailure)

```javascript
// ~/.self-generation/hooks/error-logger.mjs
import { insertEvent, getProjectName, readStdin } from '../lib/db.mjs';

try {
  const input = readStdin();

  const entry = {
    v: 1,
    type: 'tool_error',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    tool: input.tool_name,
    error: normalizeError(input.error || ''),
    errorRaw: (input.error || '').slice(0, 500)
  };

  insertEvent(entry);
  process.exit(0);
} catch (e) {
  process.exit(0);
}

function normalizeError(error) {
  // 정규화 순서: 경로 → 숫자 → 문자열 (순서 의존적: 숫자가 먼저 치환되므로 문자열 내 숫자도 치환됨)
  return error
    .replace(/\/[\w/.\-@]+/g, '<PATH>')
    .replace(/\d{2,}/g, '<N>')
    .replace(/'[^']{0,100}'/g, '<STR>')
    .replace(/"[^"]{0,100}"/g, '<STR>')
    .slice(0, 200)
    .trim();
}
```

### 4.6 세션 요약 훅 (SessionEnd)

> **참고 (v5)**: 이 훅은 세션 요약만 기록한다. AI 분석 트리거는 Phase 2의
> session-summary.mjs 확장판(5.4절)에서 담당한다. 구현 시 이 기본 버전을
> 5.4절 코드로 교체하면 된다.

```javascript
// ~/.self-generation/hooks/session-summary.mjs (기본 버전, Phase 1용)
import { insertEvent, queryEvents, getProjectName, readStdin } from '../lib/db.mjs';

try {
  const input = readStdin();

  // 이 세션의 이벤트들을 집계 (SQL 인덱스 기반, 전체 스캔 불필요)
  const sessionEntries = queryEvents({ sessionId: input.session_id });

  const prompts = sessionEntries.filter(e => e.type === 'prompt');
  const tools = sessionEntries.filter(e => e.type === 'tool_use');
  const errors = sessionEntries.filter(e => e.type === 'tool_error');

  const toolCounts = {};
  for (const t of tools) {
    toolCounts[t.tool] = (toolCounts[t.tool] || 0) + 1;
  }

  const toolSequence = tools.map(t => t.tool);

  const entry = {
    v: 1,
    type: 'session_summary',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    promptCount: prompts.length,
    toolCounts,
    toolSequence,
    errorCount: errors.length,
    uniqueErrors: [...new Set(errors.map(e => e.error))]
    // v5: intents, topKeywords 제거 → AI 분석 단계에서 처리
  };

  insertEvent(entry);
  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

---

## 5. Phase 2: AI 기반 패턴 분석 레이어

> **설계 변경 (v5)**: 정적 분석(Jaccard 클러스터링, n-gram 시퀀스 마이닝, 규칙 기반 에러 패턴)을
> `claude --print` 기반 AI 분석으로 전면 교체.
>
> **이유**:
> - 의미적 유사도 인식: "TS 프로젝트 초기화해줘"와 "타입스크립트 셋업해줘"를 같은 의도로 판단
> - 한국어/영어 혼용 완벽 지원 (Jaccard 임계값 튜닝 불필요)
> - 에러 규칙 도출이 6개 하드코딩에서 무제한으로 확장
> - 워크플로우 분석 시 Read→Edit 같은 일반 패턴을 자동 필터링
> - 분석 모듈 5개(keyword-extractor, clustering, sequence-mining, error-patterns, suggestion-engine) 제거

### 5.1 분석 전략

| 모드 | 시점 | 방식 | 소요 시간 |
|------|------|------|----------|
| **AI 분석** | SessionEnd 훅 (비동기) | `claude --print`로 수집 데이터 분석 → `analysis_cache` 테이블 저장 | 10-30초 (백그라운드) |
| **캐시 주입** | SessionStart 훅 | `analysis_cache` 테이블 조회 → `additionalContext`로 주입 | <1ms (SQLite 인덱스) |
| **수동 분석** | CLI 실행 (`node ~/.self-generation/bin/analyze.mjs`) | `claude --print` 대화형 분석 | 10-30초 |

**핵심 설계**: 비용이 드는 AI 분석은 SessionEnd에서 비동기로 실행하고,
SessionStart에서는 DB 캐시만 읽어 주입하므로 세션 시작 지연이 없다.

### 5.2 AI 분석 프롬프트 템플릿

```markdown
<!-- ~/.self-generation/prompts/analyze.md -->

아래는 Claude Code 사용자의 최근 {{days}}일간 사용 로그이다.
프로젝트: {{project}} (전역 분석 시 "all")

## 로그 데이터

{{log_data}}

## 피드백 이력

{{feedback_history}}

## 기존 스킬 목록

{{existing_skills}}

## 제안 효과 메트릭

{{outcome_metrics}}

## 분석 지시

위 로그를 분석하여 다음을 JSON으로 출력하라:

1. **반복 프롬프트 클러스터**: 의미적으로 유사한 프롬프트를 그룹핑하라.
   - 표면적 키워드가 달라도 의도가 같으면 같은 클러스터로 묶어라.
   - 예: "TS 초기화", "타입스크립트 셋업", "새 TS 프로젝트" → 같은 클러스터

2. **반복 도구 시퀀스**: 여러 세션에서 반복되는 의미 있는 도구 패턴을 감지하라.
   - Read→Edit 같은 기본 패턴은 제외하라.
   - "Grep → Read → Edit → Bash(test)" 같은 목적이 있는 워크플로우만 포함하라.

3. **반복 에러 패턴**: 동일/유사 에러가 반복되면 방지 규칙을 도출하라.
   - 에러 메시지의 정규화된 형태와 원본을 모두 고려하라.
   - 규칙은 CLAUDE.md에 추가할 수 있는 자연어 지침으로 작성하라.

4. **개선 제안**: 각 패턴에 대해 아래 3가지 유형 중 적합한 제안을 생성하라:
   - `skill`: 커스텀 스킬 생성 (반복 작업 자동화)
   - `claude_md`: CLAUDE.md 지침 추가 (반복 지시 영구화)
   - `hook`: 훅 워크플로우 등록 (반복 도구 패턴 자동화)

5. **스킬 설명 및 키워드**: 각 기존 스킬에 대해, 스킬의 목적을 한 줄로 설명하고
   관련 키워드를 추출하라. (벡터 임베딩 생성에 사용됨)
   - 예: "ts-init" → { description: "TypeScript 프로젝트 초기화 및 린터 설정", keywords: ["typescript", "초기화", "eslint", "prettier", "setup"] }

## 제안 품질 기준 (v7)

우선순위:
- 빈도(3회 이상 반복) × 복잡도(프롬프트 길이 또는 도구 수) = 절감 잠재력
- 빈도 2회 이하의 패턴은 제안하지 마라
- 기존 스킬 목록(`existing_skills`)과 중복되는 제안은 하지 마라
- 제안 효과 메트릭에서 사용률이 낮은 유형의 제안은 줄여라

제안하지 말아야 할 것:
- "코드를 더 잘 작성하세요" 같은 일반적 조언
- Read → Edit 같은 기본 도구 패턴
- 1회만 발생한 에러에 대한 규칙

## 출력 형식 (JSON)

```json
{
  "clusters": [
    {
      "id": "cluster-0",
      "summary": "클러스터 요약",
      "intent": "setup|feature-add|bug-fix|refactor|query|...",
      "count": 5,
      "examples": ["프롬프트 원문1", "프롬프트 원문2"],
      "firstSeen": "ISO8601",
      "lastSeen": "ISO8601"
    }
  ],
  "workflows": [
    {
      "pattern": "Grep → Read → Edit → Bash(test)",
      "count": 4,
      "purpose": "코드 검색 후 수정 및 테스트",
      "sessions": 10
    }
  ],
  "errorPatterns": [
    {
      "pattern": "정규화된 에러",
      "count": 3,
      "tools": ["Bash"],
      "proposedRule": "CLAUDE.md에 추가할 규칙"
    }
  ],
  "suggestions": [
    {
      "type": "skill|claude_md|hook",
      "id": "suggest-0",
      "summary": "제안 요약",
      "evidence": "근거 설명",
      "action": "구체적 적용 방법",
      "priority": 1,
      "skillName": "ts-init (skill 유형만)",
      "rule": "규칙 텍스트 (claude_md 유형만)"
    }
  ],
  "skill_descriptions": {
    "skill-name": {
      "description": "스킬 목적 한 줄 설명",
      "keywords": ["keyword1", "keyword2", "키워드3"]
    }
  }
}
```

JSON만 출력하라. 다른 텍스트는 포함하지 마라.
```

### 5.3 AI 분석 실행 모듈

```javascript
// ~/.self-generation/lib/ai-analyzer.mjs
import { execSync, spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb, queryEvents } from './db.mjs';
import { getFeedbackSummary } from './feedback-tracker.mjs';
import { loadSkills } from './skill-matcher.mjs';

const GLOBAL_DIR = join(process.env.HOME, '.self-generation');
const PROMPT_TEMPLATE = join(GLOBAL_DIR, 'prompts', 'analyze.md');

/**
 * AI 분석 실행 (동기)
 * SessionEnd 훅 또는 CLI에서 호출
 */
export function runAnalysis(options = {}) {
  const { days = 7, project = null } = options;

  const since = new Date(Date.now() - days * 86400000).toISOString();
  const filter = { since };
  if (project) filter.project = project;

  const entries = queryEvents(filter);

  // 최소 데이터 체크: 프롬프트 5개 미만이면 분석 생략
  const prompts = entries.filter(e => e.type === 'prompt');
  if (prompts.length < 5) {
    return { suggestions: [], reason: 'insufficient_data' };
  }

  // 로그 데이터를 요약하여 프롬프트에 주입 (토큰 절약)
  const logSummary = summarizeForPrompt(entries);
  const prompt = buildPrompt(logSummary, days, project);

  try {
    // claude --print: 비대화형 모드로 실행, JSON 응답만 받음
    const result = execSync(
      'claude --print',
      {
        input: prompt,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      }
    );

    const analysis = JSON.parse(extractJSON(result));

    // 캐시를 DB에 저장 (analysis_cache 테이블)
    const db = getDb();
    db.prepare(`
      INSERT INTO analysis_cache (ts, project, days, analysis)
      VALUES (?, ?, ?, ?)
    `).run(new Date().toISOString(), project || 'all', days, JSON.stringify(analysis));

    return analysis;
  } catch (e) {
    // AI 분석 실패 시 빈 결과 반환 (시스템 안정성 우선)
    return { suggestions: [], error: e.message };
  }
}

/**
 * AI 분석을 백그라운드로 실행 (비동기)
 * SessionEnd 훅에서 호출
 */
export function runAnalysisAsync(options = {}) {
  const args = ['--print'];
  const { days = 7, project = null } = options;

  const child = spawn('node', [join(GLOBAL_DIR, 'bin', 'analyze.mjs'),
    '--days', String(days),
    ...(project ? ['--project', project] : [])
  ], {
    detached: true,
    stdio: 'ignore'
  });

  child.unref(); // 부모 프로세스와 분리
}

/**
 * 캐시된 분석 결과 조회 (DB 기반)
 * SessionStart 훅에서 호출
 */
export function getCachedAnalysis(maxAgeHours = 24) {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - maxAgeHours * 3600000).toISOString();

    const row = db.prepare(`
      SELECT analysis FROM analysis_cache
      WHERE ts >= ?
      ORDER BY ts DESC LIMIT 1
    `).get(cutoff);

    if (!row) return null;
    return JSON.parse(row.analysis);
  } catch {
    return null;
  }
}

/**
 * 로그 엔트리를 프롬프트에 적합한 크기로 요약
 * 전체 로그를 그대로 전달하면 토큰 낭비이므로 핵심 정보만 추출
 */
function summarizeForPrompt(entries, maxPrompts = 100) {
  const prompts = entries
    .filter(e => e.type === 'prompt')
    .slice(-maxPrompts)
    .map(e => ({ ts: e.ts, text: e.text, project: e.project }));

  const tools = entries.filter(e => e.type === 'tool_use');
  const errors = entries.filter(e => e.type === 'tool_error');
  const summaries = entries.filter(e => e.type === 'session_summary');

  // 세션별 도구 시퀀스 (요약)
  const sessionTools = {};
  for (const t of tools) {
    if (!sessionTools[t.sessionId]) sessionTools[t.sessionId] = [];
    sessionTools[t.sessionId].push(t.tool);
  }

  return {
    prompts,
    toolSequences: Object.values(sessionTools).map(seq => seq.join(' → ')),
    errors: errors.map(e => ({
      tool: e.tool, error: e.error, raw: e.errorRaw
    })),
    sessionCount: summaries.length,
    toolTotal: tools.length
  };
}

function buildPrompt(logSummary, days, project) {
  let template = readFileSync(PROMPT_TEMPLATE, 'utf-8');
  template = template.replace('{{days}}', String(days));
  template = template.replace('{{project}}', project || 'all');
  template = template.replace('{{log_data}}', JSON.stringify(logSummary, null, 2));

  // 피드백 이력 주입 (AI가 이전 채택/거부 패턴을 참고하도록)
  const feedback = getFeedbackSummary();
  template = template.replace('{{feedback_history}}',
    feedback ? JSON.stringify(feedback, null, 2) : '피드백 이력 없음 (첫 분석)');

  // P3: 기존 스킬 목록 주입 (v7)
  // project name → projectPath 조회 (이벤트에서 가장 최근 경로 사용)
  const projectPath = project
    ? queryEvents({ project, limit: 1 })[0]?.projectPath || null
    : null;
  const skills = loadSkills(projectPath);
  template = template.replace('{{existing_skills}}',
    skills.length > 0 ? skills.map(s => `- ${s.name}: ${s.description || ''}`).join('\n') : '등록된 스킬 없음');

  // P5: 제안 효과 메트릭 주입 (v7)
  const outcomes = {
    skillUsageRate: feedback?.skillUsageRate,
    ruleEffectiveness: feedback?.ruleEffectiveness,
    staleSkills: feedback?.staleSkills
  };
  template = template.replace('{{outcome_metrics}}',
    JSON.stringify(outcomes, null, 2));

  return template;
}

/**
 * Claude 응답에서 JSON 부분만 추출
 * 응답에 ```json ... ``` 블록이 있으면 그 안의 내용만 추출
 */
function extractJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) return match[1];

  // JSON 블록이 없으면 전체를 JSON으로 시도
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}
```

### 5.4 SessionEnd 훅 (AI 분석 트리거)

세션 요약 기록 후, 비동기로 AI 분석을 실행한다.

```javascript
// ~/.self-generation/hooks/session-summary.mjs
import { insertEvent, queryEvents, getProjectName, getDb, readStdin } from '../lib/db.mjs';
import { runAnalysisAsync } from '../lib/ai-analyzer.mjs';

try {
  const input = readStdin();

  // P8: 비정상/미니멀 세션은 AI 분석 생략 (v7)
  const skipAnalysis = input.reason === 'clear' || false;

  // 이 세션의 이벤트들을 집계 (SQL 인덱스 기반)
  const sessionEntries = queryEvents({ sessionId: input.session_id });

  const prompts = sessionEntries.filter(e => e.type === 'prompt');
  const tools = sessionEntries.filter(e => e.type === 'tool_use');
  const errors = sessionEntries.filter(e => e.type === 'tool_error');

  const toolCounts = {};
  for (const t of tools) {
    toolCounts[t.tool] = (toolCounts[t.tool] || 0) + 1;
  }

  const toolSequence = tools.map(t => t.tool);

  const entry = {
    v: 1,
    type: 'session_summary',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    promptCount: prompts.length,
    toolCounts,
    toolSequence,
    errorCount: errors.length,
    uniqueErrors: [...new Set(errors.map(e => e.error))],
    // P2: 태스크레벨 세션 컨텍스트 (v7)
    lastPrompts: prompts.slice(-3).map(p => (p.text || '').slice(0, 100)),
    lastEditedFiles: [...new Set(
      tools
        .filter(t => t.tool === 'Edit' || t.tool === 'Write')
        .map(t => t.meta?.file)
        .filter(Boolean)
    )].slice(-5),
    reason: input.reason || 'unknown'  // P8: 세션 종료 사유 (v7)
  };

  insertEvent(entry);

  // AI 분석을 백그라운드로 트리거 (세션 종료를 블로킹하지 않음)
  // P8: reason='clear'이거나 프롬프트 3개 미만이면 분석 생략 (v7)
  if (!skipAnalysis && prompts.length >= 3) {
    runAnalysisAsync({ days: 7, project: getProjectName(input.cwd) });
  }

  // v8: 임베딩 미생성 에러 KB 엔트리에 대한 배치 임베딩 트리거
  try {
    const db = getDb();
    const newErrors = db.prepare(`
      SELECT id, error_normalized FROM error_kb WHERE embedding IS NULL
    `).all();
    if (newErrors.length > 0) {
      // Synchronous embedding generation (already in SessionEnd hook)
      const { generateEmbeddings } = await import('../lib/db.mjs');
      const texts = newErrors.map(e => e.error_normalized);
      const embeddings = await generateEmbeddings(texts);

      // Update embeddings in error_kb table
      const stmt = db.prepare('UPDATE error_kb SET embedding = ? WHERE id = ?');
      newErrors.forEach((err, i) => {
        if (embeddings[i]) {
          const embeddingBlob = new Float32Array(embeddings[i]);
          stmt.run(embeddingBlob, err.id);
        }
      });
    }
  } catch { /* Embedding generation failure is non-critical */ }

  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

### 5.5 SessionStart 훅 (캐시 주입)

```javascript
// ~/.self-generation/hooks/session-analyzer.mjs
import { readStdin } from '../lib/db.mjs';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';

try {
  const input = readStdin();

  // 캐시된 AI 분석 결과 조회 (24시간 이내, DB 기반)
  const analysis = getCachedAnalysis(24);

  if (analysis && analysis.suggestions && analysis.suggestions.length > 0) {
    const msg = formatSuggestionsForContext(analysis.suggestions);
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: msg
      }
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}

function formatSuggestionsForContext(suggestions) {
  let msg = '[Self-Generation] AI 패턴 분석 결과:\n';
  for (const s of suggestions.slice(0, 3)) {
    msg += `- [${s.type}] ${s.summary} [id: ${s.id}]\n`;
  }
  msg += '\n사용자에게 이 개선 제안을 알려주세요.';
  msg += '\n사용자가 승인하면 `node ~/.self-generation/bin/apply.mjs <번호>` 로 적용하세요.';
  msg += '\n사용자가 거부하면 `node ~/.self-generation/bin/dismiss.mjs <id>` 로 기록하세요.';
  return msg;
}
```

### 5.6 심층 분석 CLI

```javascript
// ~/.self-generation/bin/analyze.mjs
// 사용법: node ~/.self-generation/bin/analyze.mjs [--days 30] [--project my-app]

import { runAnalysis } from '../lib/ai-analyzer.mjs';

const args = process.argv.slice(2);
const days = parseInt(args.find((_, i, a) => a[i - 1] === '--days') || '30');
const project = args.find((_, i, a) => a[i - 1] === '--project') || null;

console.log(`\n=== Self-Generation AI 패턴 분석 (최근 ${days}일) ===\n`);

const result = runAnalysis({ days, project });

if (result.error) {
  console.error(`분석 실패: ${result.error}`);
  process.exit(1);
}

if (result.reason === 'insufficient_data') {
  console.log('데이터 부족: 프롬프트 5개 이상 수집 후 다시 실행하세요.');
  process.exit(0);
}

// 클러스터
if (result.clusters?.length > 0) {
  console.log('--- 반복 프롬프트 클러스터 ---');
  for (const c of result.clusters) {
    console.log(`\n  [${c.count}회] ${c.intent} - ${c.summary}`);
    for (const ex of c.examples.slice(0, 3)) {
      console.log(`    "${ex}"`);
    }
  }
}

// 워크플로우
if (result.workflows?.length > 0) {
  console.log('\n--- 반복 도구 시퀀스 ---');
  for (const w of result.workflows) {
    console.log(`  [${w.count}회] ${w.pattern} (${w.purpose})`);
  }
}

// 에러 패턴
if (result.errorPatterns?.length > 0) {
  console.log('\n--- 반복 에러 패턴 ---');
  for (const ep of result.errorPatterns) {
    console.log(`  [${ep.count}회] ${ep.pattern}`);
    if (ep.proposedRule) console.log(`    → 규칙: "${ep.proposedRule}"`);
  }
}

// 제안
if (result.suggestions?.length > 0) {
  console.log('\n=== 개선 제안 ===\n');
  for (let i = 0; i < result.suggestions.length; i++) {
    const s = result.suggestions[i];
    console.log(`${i + 1}. [${s.type}] ${s.summary}`);
    console.log(`   근거: ${s.evidence}`);
    console.log(`   제안: ${s.action}\n`);
  }
}

console.log('---');
console.log('제안을 적용하려면: node ~/.self-generation/bin/apply.mjs <번호>');
```

### 5.7 정적 분석 대비 AI 분석 비교

| 항목 | 정적 분석 (v1-v4) | AI 분석 (v5) |
|------|-------------------|-------------|
| 의미 유사도 | Jaccard (키워드 겹침만) | 완전한 의미 이해 |
| 한국어 지원 | 공백 분할 (형태소 분석 없음) | 네이티브 수준 |
| 에러 규칙 도출 | 6개 하드코딩 패턴 | 무제한 (AI가 자유 생성) |
| 워크플로우 필터링 | 없음 (Read→Edit도 감지) | 의미 있는 패턴만 선별 |
| 코드 복잡도 | 5개 모듈, ~400줄 | 1개 모듈 + 프롬프트 템플릿 |
| 실행 비용 | 0원 | ~$0.01-0.05/회 |
| 실행 시간 | <500ms | 10-30초 (백그라운드) |
| 외부 의존성 | 없음 | `claude` CLI 필요 |

#### v5 전환 시 모듈 변경

**제거된 모듈** (5개, ~400줄):
- `lib/keyword-extractor.mjs` — 키워드/인텐트 추출
- `lib/clustering.mjs` — Jaccard 클러스터링
- `lib/sequence-mining.mjs` — 도구 시퀀스 마이닝
- `lib/error-patterns.mjs` — 에러 패턴 감지
- `lib/suggestion-engine.mjs` — 제안 생성 통합

**추가된 모듈** (2개):
- `lib/ai-analyzer.mjs` — `claude --print` 실행, 캐시 관리
- `prompts/analyze.md` — AI 분석 프롬프트 템플릿

#### v8 전환 시 모듈 변경

**교체된 모듈** (1개):
- `lib/log-writer.mjs` → `lib/db.mjs` — JSONL 읽기/쓰기를 SQLite + sqlite-vec 기반으로 전환

**변경된 모듈** (4개):
- `lib/ai-analyzer.mjs` — 캐시 저장을 파일에서 `analysis_cache` 테이블로 전환
- `lib/error-kb.mjs` — 벡터 유사도 검색 추가 (`error_kb` 테이블 + sqlite-vec)
- `lib/skill-matcher.mjs` — 벡터 기반 스킬 매칭 추가 (`skill_embeddings` 테이블), `loadSynonymMap()` 제거
- `lib/feedback-tracker.mjs` — JSONL에서 `feedback` 테이블로 전환

**추가된 의존성** (3개):
- `better-sqlite3` — Node.js 네이티브 SQLite3 바인딩
- `sqlite-vec` — SQLite 벡터 유사도 검색 확장
- `@xenova/transformers` — 로컬 임베딩 생성 (paraphrase-multilingual-MiniLM-L12-v2, 384차원)

#### 트레이드오프

| 항목 | 변화 | 수용 가능성 |
|------|------|:---------:|
| 분석 비용 | 0원 → ~$0.01-0.05/회 | 높음 (절감 토큰 비용이 분석 비용 초과) |
| 분석 시간 | <500ms → 10-30초 | 높음 (백그라운드 실행으로 UX 무영향) |
| 외부 의존성 | 없음 → `claude` CLI | 높음 (Claude Code 사용자에게 이미 설치됨) |
| 네트워크 | 불필요 → API 호출 | 중간 (프롬프트는 이미 API로 전송 중) |

---

## 6. Phase 3: 제안 적용 엔진

> **설계 변경 (v5)**: 제안 생성은 Phase 2의 AI 분석(`claude --print`)이 담당.
> Phase 3는 AI가 생성한 제안을 **적용하는 역할**에 집중한다.

### 6.1 제안 적용 도구

```javascript
// ~/.self-generation/bin/apply.mjs
// 사용법: node ~/.self-generation/bin/apply.mjs <suggestion-number> [--global]

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';
import { recordFeedback } from '../lib/feedback-tracker.mjs';

const args = process.argv.slice(2);
const num = parseInt(args[0]);
const isGlobal = args.includes('--global');

if (isNaN(num)) {
  console.error('사용법: node ~/.self-generation/bin/apply.mjs <번호> [--global]');
  process.exit(1);
}

// AI 분석 캐시에서 제안 목록 조회
const analysis = getCachedAnalysis(168); // 7일 이내 캐시
if (!analysis || !analysis.suggestions?.length) {
  console.error('분석 결과가 없습니다. 먼저 node ~/.self-generation/bin/analyze.mjs 를 실행하세요.');
  process.exit(1);
}

const suggestions = analysis.suggestions;
if (num < 1 || num > suggestions.length) {
  console.error(`유효한 범위: 1-${suggestions.length}`);
  process.exit(1);
}

const suggestion = suggestions[num - 1];

const options = { apply: args.includes('--apply') };

switch (suggestion.type) {
  case 'skill':
    applySkill(suggestion);
    break;
  case 'claude_md':
    applyClaudeMd(suggestion);
    break;
  case 'hook': {
    // P6: 반자동 훅 워크플로우 생성 (v7)
    const GLOBAL_DIR = join(process.env.HOME, '.self-generation');
    const hookDir = join(GLOBAL_DIR, 'hooks', 'auto');
    mkdirSync(hookDir, { recursive: true });

    const hookFile = join(hookDir, `workflow-${suggestion.id}.mjs`);
    const settingsEntry = {
      hooks: [{
        type: 'command',
        command: `node ${hookFile}`
      }]
    };

    if (suggestion.hookCode) {
      // AI가 생성한 훅 코드를 파일로 저장
      writeFileSync(hookFile, suggestion.hookCode);
      console.log(`✅ 훅 스크립트 생성됨: ${hookFile}`);
      console.log(`📋 settings.json에 추가할 항목:`);
      console.log(JSON.stringify({ [suggestion.hookEvent || 'PostToolUse']: settingsEntry }, null, 2));

      if (options.apply) {
        // --apply 플래그: settings.json에 자동 등록
        const settingsPath = join(process.env.HOME, '.claude', 'settings.json');
        const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : {};
        const event = suggestion.hookEvent || 'PostToolUse';
        if (!settings[event]) settings[event] = [];
        settings[event].push(settingsEntry);
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log(`✅ settings.json에 등록 완료`);
      } else {
        console.log(`💡 자동 등록: node ~/.self-generation/bin/apply.mjs ${suggestion.id} --apply`);
      }
    } else {
      console.log(`⚠️ 훅 코드 미생성 — 프롬프트 템플릿에 hookCode 필드를 요청하세요`);
    }
    break;
  }
}

// 피드백 기록
recordFeedback(suggestion.id, 'accepted', {
  suggestionType: suggestion.type,
  summary: suggestion.summary
});

function applySkill(suggestion) {
  const baseDir = isGlobal
    ? join(process.env.HOME, '.claude', 'commands')
    : join(process.cwd(), '.claude', 'commands');

  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });

  // AI가 생성한 skillName 사용 (의미 기반 네이밍)
  const name = suggestion.skillName || 'auto-skill';
  const filePath = join(baseDir, `${name}.md`);
  const scope = isGlobal ? '전역' : '프로젝트';

  const content = [
    `# /${name}`,
    '',
    `AI가 감지한 반복 패턴에서 생성된 ${scope} 스킬입니다.`,
    '',
    '## 감지된 패턴',
    ...(suggestion.evidence ? [`- ${suggestion.evidence}`] : []),
    '',
    '## 실행 지침',
    '',
    suggestion.action || '$ARGUMENTS',
    ''
  ].join('\n');

  writeFileSync(filePath, content);
  console.log(`${scope} 스킬 생성: ${filePath}`);
  console.log(`사용법: Claude Code에서 /${name} 입력`);
}

function applyClaudeMd(suggestion) {
  const claudeMdPath = isGlobal
    ? join(process.env.HOME, '.claude', 'CLAUDE.md')
    : join(process.cwd(), '.claude', 'CLAUDE.md');

  const claudeDir = join(claudeMdPath, '..');
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  // AI가 생성한 rule 텍스트 직접 사용
  const rule = suggestion.rule || suggestion.summary;
  const scope = isGlobal ? '전역' : '프로젝트';

  let content = '';
  if (existsSync(claudeMdPath)) {
    content = readFileSync(claudeMdPath, 'utf-8');
  }

  if (content.includes(rule)) {
    console.log('이미 동일한 규칙이 존재합니다.');
    return;
  }

  const section = '\n\n## 자동 감지된 규칙\n';
  if (!content.includes('## 자동 감지된 규칙')) {
    content += section;
  }

  content += `- ${rule}\n`;
  writeFileSync(claudeMdPath, content);
  console.log(`${scope} CLAUDE.md 업데이트: ${claudeMdPath}`);
  console.log(`추가된 규칙: "${rule}"`);
}
```

### 6.1.1 제안 거부 도구

```javascript
// ~/.self-generation/bin/dismiss.mjs
// 사용법: node ~/.self-generation/bin/dismiss.mjs <suggestion-id>

import { recordFeedback } from '../lib/feedback-tracker.mjs';

const args = process.argv.slice(2);
const suggestionId = args[0];

if (!suggestionId) {
  console.error('사용법: node ~/.self-generation/bin/dismiss.mjs <suggestion-id>');
  process.exit(1);
}

recordFeedback(suggestionId, 'rejected', {
  suggestionType: 'unknown'
});

console.log(`제안 거부 기록됨: ${suggestionId}`);
console.log('이 패턴은 향후 AI 분석 시 제외 컨텍스트로 전달됩니다.');
```

### 6.2 사용자 승인 플로우

```
[SessionEnd 훅]
  │
  ├─ 세션 요약 기록 (events 테이블)
  │
  └─ AI 분석 백그라운드 트리거 (claude --print)
       │
       └─ analysis_cache 테이블에 결과 저장

[SessionStart 훅]
  │
  ├─ analysis_cache 테이블 조회 (<1ms, SQLite 인덱스)
  │
  ├─ 캐시된 제안이 있으면?
  │    │
  │    ├─ Yes → additionalContext로 Claude에게 전달
  │    │        Claude가 사용자에게 자연어로 안내:
  │    │        "AI 분석 결과, 'TS 프로젝트 초기화' 작업을
  │    │         5번 반복하셨습니다. /ts-init 스킬을 만들어드릴까요?"
  │    │         ├─ 승인 → node ~/.self-generation/bin/apply.mjs <번호>
  │    │         └─ 거부 → node ~/.self-generation/bin/dismiss.mjs <id>
  │    │
  │    └─ No → 조용히 패스
  │
  └─ 계속 수집

[CLI 수동 분석]
  │
  ├─ node ~/.self-generation/bin/analyze.mjs [--days 30]
  │   → claude --print로 심층 분석 → 리포트 + 제안 목록
  │
  └─ node ~/.self-generation/bin/apply.mjs <번호> [--global]
      → 선택한 제안 적용
```

---

## 7. Phase 4: 피드백 루프

> **설계 변경 (v5)**: AI 분석이 처음부터 높은 품질의 제안을 생성하므로,
> 임계값 자동 조정(v1-v4의 핵심 로직)은 제거한다.
> 대신 피드백 데이터를 **AI 분석 프롬프트의 컨텍스트**로 주입하여
> Claude가 사용자 선호도를 직접 학습하게 한다.

### 7.1 채택 추적

```javascript
// ~/.self-generation/lib/feedback-tracker.mjs
import { getDb, queryEvents } from './db.mjs';
import { loadSkills } from './skill-matcher.mjs';

/**
 * 피드백 기록 (feedback 테이블에 INSERT)
 */
export function recordFeedback(suggestionId, action, details = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO feedback (v, ts, suggestion_id, action, suggestion_type, summary)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    1,
    new Date().toISOString(),
    suggestionId,
    action,    // 'accepted' | 'rejected' | 'dismissed'
    details.suggestionType || null,
    details.summary || null
  );
}

/**
 * 스킬 실제 사용률 계산 (P5: v7)
 */
function calcSkillUsageRate() {
  try {
    const db = getDb();
    const skillUsed = db.prepare(
      `SELECT COUNT(*) AS cnt FROM events WHERE type = 'skill_used'`
    ).get().cnt;
    const skillCreated = db.prepare(
      `SELECT COUNT(*) AS cnt FROM events WHERE type = 'prompt' AND json_extract(data, '$.intent') = 'skill_created'`
    ).get().cnt;
    return skillCreated > 0 ? skillUsed / skillCreated : null;
  } catch { return null; }
}

/**
 * 규칙 효과성 측정 (P5: v7)
 * 규칙이 있는 에러가 재발했는지 확인
 */
function calcRuleEffectiveness() {
  try {
    const db = getDb();
    const totalErrors = db.prepare(
      `SELECT COUNT(*) AS cnt FROM events WHERE type = 'tool_error'`
    ).get().cnt;
    const recentCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentErrors = db.prepare(
      `SELECT COUNT(*) AS cnt FROM events WHERE type = 'tool_error' AND ts >= ?`
    ).get(recentCutoff).cnt;
    return { totalErrors, recentErrors };
  } catch { return null; }
}

/**
 * 장기 미사용 스킬 탐지 (P5: v7)
 */
function findStaleSkills(days, projectPath = null) {
  try {
    const skills = loadSkills(projectPath);
    const db = getDb();
    const threshold = new Date(Date.now() - days * 86400000).toISOString();
    return skills
      .filter(s => {
        const lastUsage = db.prepare(`
          SELECT ts FROM events
          WHERE type = 'skill_used' AND json_extract(data, '$.skillName') = ?
          ORDER BY ts DESC LIMIT 1
        `).get(s.name);
        return !lastUsage || lastUsage.ts < threshold;
      })
      .map(s => s.name);
  } catch { return []; }
}

/**
 * 피드백 요약 조회 (AI 분석 프롬프트에 주입용)
 * AI가 이전 채택/거부 이력을 보고 제안 품질을 자체 조정
 */
export function getFeedbackSummary() {
  try {
    const db = getDb();
    const entries = db.prepare(`SELECT * FROM feedback ORDER BY ts ASC`).all();

    if (entries.length === 0) return null;

    const accepted = entries.filter(e => e.action === 'accepted');
    const rejected = entries.filter(e => e.action === 'rejected' || e.action === 'dismissed');

    return {
      total: entries.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      rate: entries.length > 0 ? accepted.length / entries.length : 0,
      // 최근 거부된 제안 요약 (AI가 유사 제안을 피하도록)
      recentRejections: rejected.slice(-10).map(e => e.summary || e.suggestion_id),
      // 최근 채택된 제안 요약 (AI가 선호 패턴을 학습하도록)
      recentAcceptances: accepted.slice(-10).map(e => e.summary || e.suggestion_id),
      // P5: 제안 효과 메트릭 (v7)
      skillUsageRate: calcSkillUsageRate(),
      ruleEffectiveness: calcRuleEffectiveness(),
      staleSkills: findStaleSkills(30) // 30일 이상 미사용
    };
  } catch { return null; }
}
```

### 7.2 피드백 → AI 프롬프트 주입

AI 분석 실행 시 `getFeedbackSummary()`의 결과를 프롬프트에 추가한다:

```markdown
<!-- analyze.md 프롬프트 하단에 조건부 추가 -->

## 사용자 피드백 이력 (선호도 학습용)

채택률: {{rate}}% ({{total}}건 중 {{acceptedCount}}건 채택)

최근 거부된 제안 (유사 제안 피할 것):
{{recentRejections}}

최근 채택된 제안 (이런 유형의 제안 선호):
{{recentAcceptances}}
```

이 방식의 장점:
- **정적 임계값 조정 불필요**: Claude가 피드백 맥락을 이해하고 자체 판단
- **유연한 학습**: "이 사용자는 스킬보다 CLAUDE.md 규칙을 선호한다" 같은 미묘한 패턴도 학습
- **설명 가능성**: AI가 왜 특정 제안을 했는지 근거를 함께 생성

---

## 8. Phase 5: 실시간 어시스턴스 레이어

> **추가 (v6)**: 참조 훅 시스템 분석을 통해 도출된 실시간 어시스턴스 기능.
> Phase 2의 배치 분석이 "세션 간" 개선이라면, Phase 5는 "세션 내" 즉시 도움을 제공한다.
>
> **설계 원칙**: 배치 분석(Phase 2)과 상호 보완. 배치는 장기 패턴을, 실시간은 즉각 대응을 담당.

#### v6에서 추가된 기능

참조 훅 시스템 분석을 통해 도출된 5개 실시간 어시스턴스 기능:

| # | 기능 | 훅 이벤트 | 효과 |
|---|------|----------|------|
| 1 | 에러 KB 실시간 검색 | PostToolUseFailure | 에러 대응: 배치→실시간 |
| 2 | 스킬 자동 감지 | UserPromptSubmit | 생성된 스킬 활용률 향상 |
| 3 | 서브에이전트 성능 추적 | SubagentStop | 에이전트 사용 최적화 |
| 4 | 세션 간 컨텍스트 주입 | SessionStart | 세션 연속성 확보 |
| 5 | 세션 종료 코칭 | SessionEnd에 통합 | AI 분석 결과에 포함 |

#### v7에서 추가된 기능

아키텍트 검증 후 12개 개선안 중 Phase 5 관련 기능:

| # | 기능 | 훅 이벤트 | 제안 |
|---|------|----------|------|
| P1 | 사전 예방 가이드 | PreToolUse | 도구 실행 전 에러이력/성능 기반 경고 |
| P9 | 서브에이전트 학습 전파 | SubagentStart | 서브에이전트에 프로젝트별 학습 데이터 주입 |

**추가된 모듈 (v6)**:
- `lib/error-kb.mjs` — 에러 KB 검색/기록
- `lib/skill-matcher.mjs` — 스킬-프롬프트 매칭
- `hooks/subagent-tracker.mjs` — 서브에이전트 추적

**추가된 모듈 (v7)**:
- `hooks/pre-tool-guide.mjs` — PreToolUse 사전 예방 가이드
- `hooks/subagent-context.mjs` — SubagentStart 컨텍스트 주입

**변경된 모듈 (v8)**:
- `lib/error-kb.mjs` — 벡터 유사도 검색 추가 (`error_kb` 테이블 + sqlite-vec)
- `lib/skill-matcher.mjs` — 벡터 기반 매칭 추가 (`skill_embeddings` 테이블), `loadSynonymMap()` 제거

### 8.1 에러 KB 실시간 검색

에러 발생 즉시 과거 동일 에러의 해결 이력을 벡터 유사도 + 텍스트 폴백으로 검색하여 Claude에게 주입한다.

```javascript
// ~/.self-generation/lib/error-kb.mjs
import { getDb, vectorSearch, generateEmbeddings } from './db.mjs';

/**
 * 에러 메시지 정규화 (단일 소유자: error-kb.mjs)
 * 경로, 숫자, 문자열 리터럴을 플레이스홀더로 치환하여 동일 패턴 에러를 그룹화
 */
export function normalizeError(error) {
  return error
    .replace(/\/[\w/.\-@]+/g, '<PATH>')
    .replace(/\d{2,}/g, '<N>')
    .replace(/'[^']{0,100}'/g, '<STR>')
    .replace(/"[^"]{0,100}"/g, '<STR>')
    .slice(0, 200)
    .trim();
}

/**
 * 에러 해결 이력 검색 (벡터 유사도 + 텍스트 폴백)
 * 정규화된 에러 메시지로 과거 해결 사례를 조회
 */
export async function searchErrorKB(normalizedError) {
  const db = getDb();

  // 1. 벡터 유사도 검색 (임베딩이 존재하는 경우)
  try {
    // Generate embedding from normalized error text first
    const embeddings = await generateEmbeddings([normalizedError]);
    if (embeddings && embeddings[0]) {
      const vectorResults = vectorSearch('error_kb', 'embedding', embeddings[0], 3);
      if (vectorResults.length > 0 && vectorResults[0].distance < 0.76) {
        // 사용 카운트 증가
        db.prepare('UPDATE error_kb SET use_count = use_count + 1, last_used = ? WHERE id = ?')
          .run(new Date().toISOString(), vectorResults[0].id);
        return vectorResults[0];
      }
    }
  } catch { /* Vector search not available, fall through to text matching */ }

  // 2. 폴백: 정확한 텍스트 매칭
  const exact = db.prepare(`
    SELECT * FROM error_kb
    WHERE error_normalized = ? AND resolution IS NOT NULL
    ORDER BY ts DESC LIMIT 1
  `).get(normalizedError);
  if (exact) {
    db.prepare('UPDATE error_kb SET use_count = use_count + 1, last_used = ? WHERE id = ?')
      .run(new Date().toISOString(), exact.id);
    return exact;
  }

  // 3. 폴백: 접두사 매칭 (첫 30자)
  const prefix = normalizedError.slice(0, 30);
  const prefixMatch = db.prepare(`
    SELECT * FROM error_kb
    WHERE error_normalized LIKE ? AND resolution IS NOT NULL
    ORDER BY ts DESC LIMIT 1
  `).get(prefix + '%');
  if (prefixMatch) {
    db.prepare('UPDATE error_kb SET use_count = use_count + 1, last_used = ? WHERE id = ?')
      .run(new Date().toISOString(), prefixMatch.id);
    return prefixMatch;
  }

  return null;
}

/**
 * 에러 해결 이력 기록 (error_kb 테이블에 INSERT)
 * PostToolUse에서 이전 에러가 해결되었을 때 호출
 * (에러 발생 후 동일 도구가 성공하면 해결로 간주)
 * NOTE: 임베딩은 여기서 생성하지 않음 (SessionEnd 배치에서 처리)
 */
export function recordResolution(normalizedError, resolution) {
  const db = getDb();
  db.prepare(`
    INSERT INTO error_kb (ts, error_normalized, error_raw, resolution, resolved_by, tool_sequence)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    normalizedError,
    resolution.errorRaw || null,
    JSON.stringify(resolution),
    resolution.resolvedBy || null,
    resolution.toolSequence ? JSON.stringify(resolution.toolSequence) : null
  );
}
```

**에러 로거 훅 확장** (error-logger.mjs에 KB 검색 추가):

```javascript
// ~/.self-generation/hooks/error-logger.mjs (v6 확장)
import { insertEvent, getProjectName, readStdin } from '../lib/db.mjs';
import { normalizeError, searchErrorKB } from '../lib/error-kb.mjs';

try {
  const input = readStdin();

  const normalized = normalizeError(input.error || '');

  // 1. 에러 기록 (events 테이블에 INSERT)
  const entry = {
    v: 1,
    type: 'tool_error',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    tool: input.tool_name,
    error: normalized,
    errorRaw: (input.error || '').slice(0, 500)
  };
  insertEvent(entry);

  // 2. 에러 KB 실시간 검색 (v6 추가)
  const kbMatch = await searchErrorKB(normalized);
  if (kbMatch) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: `[Self-Generation 에러 KB] 이전에 동일 에러를 해결한 이력이 있습니다:\n` +
          `- 에러: ${kbMatch.error_normalized}\n` +
          `- 해결 방법: ${kbMatch.resolution}\n` +
          `이 정보를 참고하여 해결을 시도하세요.`
      }
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}
// normalizeError()는 error-kb.mjs에서 import (단일 소유자 원칙)
```

### 8.2 스킬 자동 감지

사용자 프롬프트 입력 시, 이미 생성된 커스텀 스킬 중 매칭되는 것이 있으면 안내한다.

```javascript
// ~/.self-generation/lib/skill-matcher.mjs
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb, vectorSearch, generateEmbeddings } from './db.mjs';

/**
 * 기존 스킬 목록 로드 (전역 + 프로젝트)
 */
export function loadSkills(projectPath) {
  const skills = [];

  // 전역 스킬
  const globalDir = join(process.env.HOME, '.claude', 'commands');
  if (existsSync(globalDir)) {
    for (const file of readdirSync(globalDir)) {
      if (file.endsWith('.md')) {
        skills.push({
          name: file.replace('.md', ''),
          scope: 'global',
          content: readFileSync(join(globalDir, file), 'utf-8')
        });
      }
    }
  }

  // 프로젝트 스킬
  if (projectPath) {
    const projectDir = join(projectPath, '.claude', 'commands');
    if (existsSync(projectDir)) {
      for (const file of readdirSync(projectDir)) {
        if (file.endsWith('.md')) {
          skills.push({
            name: file.replace('.md', ''),
            scope: 'project',
            content: readFileSync(join(projectDir, file), 'utf-8')
          });
        }
      }
    }
  }

  return skills;
}

/**
 * 프롬프트와 스킬 간 매칭 (벡터 유사도 + 키워드 폴백)
 *
 * v8 변경: loadSynonymMap() 제거 — 벡터 유사도 검색이 시노님 맵의
 * 의미 매칭을 네이티브하게 대체한다.
 * v9 변경: claude --print → Transformers.js, 임계값 0.3 → 0.76
 */
export async function matchSkill(prompt, skills) {
  // 1. 벡터 유사도 검색 (skill_embeddings 테이블, 임베딩이 존재하는 경우)
  try {
    const embeddings = await generateEmbeddings([prompt]);
    if (embeddings && embeddings[0]) {
      const results = vectorSearch('skill_embeddings', 'embedding', embeddings[0], 1);
      if (results.length > 0 && results[0].distance < 0.76) {
        return {
          name: results[0].name,
          match: 'vector',
          confidence: 1 - results[0].distance,
          scope: skills.find(s => s.name === results[0].name)?.scope || 'global'
        };
      }
    }
  } catch { /* Vector search not available, fall through to keyword matching */ }

  // 2. 폴백: 키워드 매칭 (기존 로직)
  return keywordMatch(prompt, skills);
}

/**
 * 키워드 기반 스킬 매칭 (폴백)
 * 스킬 파일 내 "감지된 패턴" 섹션의 예시와 비교
 */
function keywordMatch(prompt, skills) {
  const promptLower = prompt.toLowerCase();

  for (const skill of skills) {
    const patterns = extractPatterns(skill.content);
    for (const pattern of patterns) {
      // 패턴 키워드가 프롬프트에 50% 이상 포함되면 매칭
      const patternWords = pattern.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const matchCount = patternWords.filter(w => promptLower.includes(w)).length;
      if (patternWords.length > 0 && matchCount / patternWords.length >= 0.5) {
        return skill;
      }
    }
  }

  return null;
}

function extractPatterns(content) {
  const patterns = [];
  const lines = content.split('\n');
  let inSection = false;
  for (const line of lines) {
    if (line.includes('감지된 패턴')) { inSection = true; continue; }
    if (line.startsWith('#')) { inSection = false; continue; }
    if (inSection && line.startsWith('- ')) {
      patterns.push(line.replace(/^- "?|"?$/g, ''));
    }
  }
  return patterns;
}
```

**프롬프트 로거 훅 확장** (prompt-logger.mjs에 스킬 감지 추가):

```javascript
// ~/.self-generation/hooks/prompt-logger.mjs (v6 확장)
import { insertEvent, getProjectName, readStdin } from '../lib/db.mjs';
import { loadSkills, matchSkill } from '../lib/skill-matcher.mjs';

try {
  const input = readStdin();

  // 1. 프롬프트 기록 (events 테이블에 INSERT)
  const entry = {
    v: 1,
    type: 'prompt',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    text: input.prompt,
    charCount: input.prompt.length
  };
  insertEvent(entry);

  // 2. 스킬 자동 감지 (v6 추가)
  const skills = loadSkills(input.cwd);
  if (skills.length > 0) {
    const matched = await matchSkill(input.prompt, skills);
    if (matched) {
      const output = {
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `[Self-Generation] 이 작업과 관련된 커스텀 스킬이 있습니다: ` +
            `\`/${matched.name}\` (${matched.scope === 'global' ? '전역' : '프로젝트'} 스킬)\n` +
            `사용자에게 이 스킬 사용을 제안해주세요.`
        }
      };
      process.stdout.write(JSON.stringify(output));
    }
  }

  // P5: 스킬 사용 이벤트 기록 (v7)
  if (input.prompt && input.prompt.startsWith('/')) {
    const skillName = input.prompt.split(/\s+/)[0].slice(1); // "/ts-init args" → "ts-init"
    insertEvent({
      v: 1,
      type: 'skill_used',
      ts: new Date().toISOString(),
      sessionId: input.session_id,
      project: getProjectName(input.cwd),
      projectPath: input.cwd,
      skillName
    });
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

### 8.3 서브에이전트 성능 추적

```javascript
// ~/.self-generation/hooks/subagent-tracker.mjs
import { insertEvent, getProjectName, readStdin } from '../lib/db.mjs';

try {
  const input = readStdin();

  const entry = {
    v: 1,
    type: 'subagent_stop',
    ts: new Date().toISOString(),
    sessionId: input.session_id,
    project: getProjectName(input.cwd),
    projectPath: input.cwd,
    agentId: input.agent_id,
    agentType: input.agent_type
  };

  insertEvent(entry);
  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

### 8.4 세션 간 컨텍스트 주입

SessionStart에서 이전 세션의 핵심 정보를 주입하여 세션 연속성을 확보한다.

**session-analyzer.mjs 확장** (캐시 주입 + 이전 세션 컨텍스트):

```javascript
// ~/.self-generation/hooks/session-analyzer.mjs (v6 확장)
import { queryEvents, getProjectName, readStdin } from '../lib/db.mjs';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';

try {
  const input = readStdin();
  const project = getProjectName(input.cwd);

  // P7: 세션 소스에 따른 컨텍스트 분기 (v7)
  const isResume = input.source === 'resume';

  const contextParts = [];

  // 1. 캐시된 AI 분석 결과 주입 (기존)
  const analysis = getCachedAnalysis(24);
  if (analysis && analysis.suggestions?.length > 0) {
    let msg = '[Self-Generation] AI 패턴 분석 결과:\n';
    for (const s of analysis.suggestions.slice(0, 3)) {
      msg += `- [${s.type}] ${s.summary} [id: ${s.id}]\n`;
    }
    msg += '\n사용자에게 이 개선 제안을 알려주세요.';
    msg += '\n사용자가 승인하면 `node ~/.self-generation/bin/apply.mjs <번호>` 로 적용하세요.';
    msg += '\n사용자가 거부하면 `node ~/.self-generation/bin/dismiss.mjs <id>` 로 기록하세요.';
    contextParts.push(msg);
  }

  // 2. 이전 세션 컨텍스트 주입 (v6 추가, SQL 인덱스 기반 조회)
  const recentSummaries = queryEvents({ type: 'session_summary', project, limit: 1 })
    .slice(-1); // 가장 최근 세션 요약 1개

  if (recentSummaries.length > 0) {
    const prev = recentSummaries[0];
    const parts = [`[Self-Generation] 이전 세션 컨텍스트 (${prev.ts}):`];
    parts.push(`- 프롬프트 ${prev.promptCount}개, 도구 ${Object.values(prev.toolCounts).reduce((a, b) => a + b, 0)}회 사용`);

    // P2: 태스크레벨 세션 컨텍스트 (v7)
    if (prev.lastPrompts?.length > 0) {
      parts.push(`- 이전 세션 마지막 작업: ${prev.lastPrompts.map(p => `"${p}"`).join(', ')}`);
    }
    if (prev.lastEditedFiles?.length > 0) {
      parts.push(`- 수정 중이던 파일: ${prev.lastEditedFiles.join(', ')}`);
    }

    if (prev.errorCount > 0) {
      parts.push(`- 미해결 에러 ${prev.errorCount}건: ${prev.uniqueErrors.slice(0, 2).join(', ')}`);
    }

    // P7: resume 세션이면 더 상세한 컨텍스트 주입 (v7)
    if (isResume && prev.uniqueErrors?.length > 0) {
      parts.push(`- [RESUME] 미해결 에러 상세: ${prev.uniqueErrors.join(', ')}`);
    }

    const topTools = Object.entries(prev.toolCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([t, c]) => `${t}(${c})`).join(', ');
    parts.push(`- 주요 도구: ${topTools}`);
    contextParts.push(parts.join('\n'));
  }

  if (contextParts.length > 0) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: contextParts.join('\n\n')
      }
    };
    process.stdout.write(JSON.stringify(output));
  }

  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

### 8.5 사전 예방 가이드 훅 (PreToolUse) — P1, v7

도구 실행 전에 과거 학습 데이터를 기반으로 사전 경고/가이드를 주입한다.

```javascript
// ~/.self-generation/hooks/pre-tool-guide.mjs
import { searchErrorKB } from '../lib/error-kb.mjs';
import { queryEvents, getDb, readStdin } from '../lib/db.mjs';

try {
  const input = readStdin();
  const parts = [];

  // 1. Edit/Write 도구: 대상 파일 관련 과거 에러 검색
  if (['Edit', 'Write'].includes(input.tool_name) && input.tool_input?.file_path) {
    const filePath = input.tool_input.file_path;
    const fileName = filePath.split('/').pop();
    const db = getDb();
    // SQL LIKE 검색으로 파일명 관련 에러 조회
    const fileErrors = db.prepare(`
      SELECT * FROM events
      WHERE type = 'tool_error' AND json_extract(data, '$.errorRaw') LIKE ?
      ORDER BY ts DESC LIMIT 3
    `).all(`%${fileName}%`);

    if (fileErrors.length > 0) {
      const errorData = JSON.parse(fileErrors[0].data);
      const kbResult = await searchErrorKB(errorData.error);
      if (kbResult) {
        parts.push(`⚠️ 이 파일 관련 과거 에러 이력: ${kbResult.error_normalized}`);
        parts.push(`   해결 방법: ${kbResult.resolution}`);
      }
    }
  }

  // 2. Bash 도구: 이전에 실패한 커맨드 경고
  if (input.tool_name === 'Bash' && input.tool_input?.command) {
    const cmdErrors = queryEvents({
      type: 'tool_error',
      sessionId: input.session_id
    }).filter(e => e.tool === 'Bash');

    if (cmdErrors.length > 0) {
      const kbResult = await searchErrorKB(cmdErrors[cmdErrors.length - 1].error);
      if (kbResult) {
        parts.push(`💡 이 세션에서 Bash 에러 발생 이력: ${kbResult.error_normalized}`);
        const resolution = typeof kbResult.resolution === 'string'
          ? JSON.parse(kbResult.resolution) : kbResult.resolution;
        if (resolution?.toolSequence) {
          parts.push(`   이전 해결 경로: ${resolution.toolSequence.join(' → ')}`);
        }
      }
    }
  }

  // 3. Task 도구: 서브에이전트 성능 데이터 안내
  if (input.tool_name === 'Task' && input.tool_input?.subagent_type) {
    const agentType = input.tool_input.subagent_type;
    const db = getDb();
    const agentStats = db.prepare(`
      SELECT data FROM events
      WHERE type = 'subagent_stop' AND json_extract(data, '$.agentType') = ?
      ORDER BY ts DESC LIMIT 20
    `).all(agentType);
    const failures = agentStats.filter(s => {
      const d = JSON.parse(s.data);
      return !d.success;
    });
    if (agentStats.length >= 5 && failures.length / agentStats.length > 0.3) {
      parts.push(`📊 ${agentType} 최근 실패율: ${Math.round(failures.length / agentStats.length * 100)}% (${agentStats.length}회 중 ${failures.length}회)`);
      parts.push(`   더 높은 티어의 에이전트 사용을 고려하세요.`);
    }
  }

  if (parts.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: parts.join('\n') }
    }));
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

### 8.6 서브에이전트 컨텍스트 주입 훅 (SubagentStart) — P9, v7

서브에이전트 시작 시 프로젝트별 학습 데이터를 주입하여 서브에이전트도 시스템의 학습 결과를 활용하도록 한다.

```javascript
// ~/.self-generation/hooks/subagent-context.mjs
import { searchErrorKB } from '../lib/error-kb.mjs';
import { queryEvents, getProjectName, readStdin } from '../lib/db.mjs';
import { getCachedAnalysis } from '../lib/ai-analyzer.mjs';

const CODE_AGENTS = ['executor', 'executor-low', 'executor-high', 'architect', 'architect-medium',
  'designer', 'designer-high', 'build-fixer', 'build-fixer-low'];

try {
  const input = readStdin();
  const agentType = input.agent_type || '';

  // 코드 작업 에이전트에만 컨텍스트 주입
  if (!CODE_AGENTS.some(a => agentType.includes(a))) {
    process.exit(0);
  }

  const parts = [];
  const project = getProjectName(input.cwd);

  // 1. 프로젝트별 최근 에러 패턴 주입 (SQL 인덱스 기반 조회)
  const projectErrors = queryEvents({ type: 'tool_error', project, limit: 3 });

  if (projectErrors.length > 0) {
    parts.push('이 프로젝트의 최근 에러 패턴:');
    for (const err of projectErrors) {
      parts.push(`- ${err.error} (${err.tool})`);
      const kb = await searchErrorKB(err.error);
      if (kb?.resolution) {
        parts.push(`  해결: ${JSON.stringify(kb.resolution).slice(0, 150)}`);
      }
    }
  }

  // 2. 캐시된 AI 분석의 관련 규칙 주입
  const analysis = getCachedAnalysis(48); // 48시간 이내 캐시
  if (analysis?.suggestions) {
    const rules = analysis.suggestions
      .filter(s => s.type === 'claude_md' && (!s.project || s.project === project))
      .slice(0, 3);
    if (rules.length > 0) {
      parts.push('적용할 프로젝트 규칙:');
      rules.forEach(r => parts.push(`- ${r.content || r.description}`));
    }
  }

  if (parts.length > 0) {
    // 최대 500자로 제한
    const context = parts.join('\n').slice(0, 500);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: context }
    }));
  }
  process.exit(0);
} catch (e) {
  process.exit(0);
}
```

### 8.7 훅 등록 (v6 추가분, v7 확장)

`~/.claude/settings.json`에 추가할 훅:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.self-generation/hooks/pre-tool-guide.mjs"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.self-generation/hooks/subagent-context.mjs"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $HOME/.self-generation/hooks/subagent-tracker.mjs"
          }
        ]
      }
    ]
  }
}
```

> **참고**: UserPromptSubmit, PostToolUseFailure 훅은 기존 등록을 유지하며
> 스크립트 내부에서 실시간 기능이 확장된다. 별도 훅 등록 불필요.

---

## 9. 데이터 스키마

> **설계 변경 (v8)**: JSONL 파일 기반 스키마를 SQLite 테이블 스키마로 전환.
> 모든 데이터는 `~/.self-generation/data/self-gen.db` 단일 파일에 통합 저장된다.

### 9.1 events 테이블 (이벤트 로그)

`prompt-log.jsonl`을 대체하며, 모든 이벤트 타입을 하나의 테이블에 저장한다.
공통 필드는 컬럼으로, 타입별 페이로드는 `data` JSON 컬럼에 저장한다.

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  v INTEGER DEFAULT 1,              -- 스키마 버전
  type TEXT NOT NULL,               -- 'prompt', 'tool_use', 'tool_error', 'skill_used',
                                    -- 'subagent_stop', 'session_summary'
  ts TEXT NOT NULL,                 -- ISO 8601
  session_id TEXT NOT NULL,
  project TEXT,                     -- 프로젝트 디렉토리명 (표시용)
  project_path TEXT,                -- 전체 경로 (정규 식별자)
  data JSON NOT NULL                -- 타입별 페이로드
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_project_type ON events(project_path, type, ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
```

#### data JSON 페이로드 (타입별)

```typescript
// type: 'prompt'
{ text: string; charCount: number }

// type: 'tool_use'
{ tool: string; meta: ToolMeta; success: true }

// type: 'tool_error'
{ tool: string; error: string; errorRaw: string }

// type: 'session_summary'
{
  promptCount: number;
  toolCounts: Record<string, number>;
  toolSequence: string[];
  errorCount: number;
  uniqueErrors: string[];
  lastPrompts: string[];
  lastEditedFiles: string[];
  reason: string;
}

// type: 'subagent_stop'
{ agentId: string; agentType: string }

// type: 'skill_used'
{ skillName: string }

type ToolMeta =
  | { command: string }                      // Bash: 첫 단어만
  | { file: string }                         // Read/Write/Edit
  | { pattern: string }                      // Grep/Glob
  | { agentType: string; model?: string }    // Task
  | {};
```

### 9.2 error_kb 테이블 (에러 해결 이력 + 벡터 임베딩)

`error-kb.jsonl`을 대체하며, sqlite-vec 벡터 유사도 검색을 지원한다.

```sql
CREATE TABLE IF NOT EXISTS error_kb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  error_normalized TEXT NOT NULL,    -- 정규화된 에러 메시지
  error_raw TEXT,                    -- 원본 에러 (최대 500자)
  resolution TEXT,                   -- 해결 방법 (JSON)
  resolved_by TEXT,                  -- 해결 방식: 'success_after_error', 'cross_tool_resolution'
  tool_sequence TEXT,                -- 해결 도구 시퀀스 (JSON array)
  use_count INTEGER DEFAULT 0,      -- KB 검색으로 활용된 횟수
  last_used TEXT,                    -- 마지막 활용 시각
  embedding BLOB                    -- sqlite-vec float[384] 벡터 (배치 생성)
);
CREATE INDEX IF NOT EXISTS idx_error_kb_error ON error_kb(error_normalized);
```

> **임베딩 전략**: `embedding` 컬럼은 INSERT 시 NULL로 저장되고,
> SessionEnd 배치에서 Transformers.js (`paraphrase-multilingual-MiniLM-L12-v2`)를 통해 생성된다.
> 검색 시 임베딩이 없으면 텍스트 매칭으로 폴백한다.
> 임계값: distance < 0.76 (고신뢰), 0.76~0.85 (저신뢰+키워드 검증), >= 0.85 (매칭 없음)

### 9.3 feedback 테이블 (제안 피드백)

`feedback.jsonl`을 대체한다.

```sql
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  v INTEGER DEFAULT 1,              -- 스키마 버전
  ts TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- 'accepted', 'rejected', 'dismissed'
  suggestion_type TEXT,             -- 'skill', 'claude_md', 'hook'
  summary TEXT
);
```

### 9.4 analysis_cache 테이블 (AI 분석 캐시)

`analysis-cache.json`을 대체한다. 여러 프로젝트/기간의 캐시를 보관할 수 있다.

```sql
CREATE TABLE IF NOT EXISTS analysis_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  project TEXT,                     -- 'all' 또는 프로젝트명
  days INTEGER,                     -- 분석 기간 (일)
  analysis JSON NOT NULL            -- 전체 분석 결과
);
```

### 9.5 skill_embeddings 테이블 (스킬 벡터 임베딩, v8 신규)

벡터 기반 스킬-프롬프트 매칭을 위한 테이블. AI 배치 분석의 `synonym_map`을 대체한다.

```sql
CREATE TABLE IF NOT EXISTS skill_embeddings (
  name TEXT PRIMARY KEY,            -- 스킬 이름
  source_path TEXT NOT NULL,        -- 스킬 파일 경로
  description TEXT,                 -- 스킬 설명
  keywords TEXT,                    -- 추출된 키워드 (JSON array)
  updated_at TEXT NOT NULL,
  embedding BLOB                    -- sqlite-vec float[384] 벡터
);
```

> **스킬 설명 이중 언어**: paraphrase-multilingual 모델은 한국어→영어 교차 의미 검색이 약하므로,
> `description` 필드에 한국어와 영어를 모두 포함한다.
> 예: "Docker 이미지 빌드 / Build Docker images and push to registry"

### 9.6 config.json

```json
{
  "enabled": true,
  "collectPromptText": true,
  "retentionDays": 90,
  "analysisOnSessionEnd": true,
  "analysisDays": 7,
  "analysisCacheMaxAgeHours": 24,
  "dbPath": "~/.self-generation/data/self-gen.db",
  "embedding": {
    "enabled": true,
    "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    "dimensions": 384,
    "threshold": 0.76,
    "batchSize": 50,
    "modelCacheDir": "~/.self-generation/models/"
  }
}
```

> **참고 (v5)**: 정적 임계값(`thresholds`)은 제거됨. AI 분석이 피드백 이력을
> 컨텍스트로 받아 제안 품질을 자체 조정하므로 수동 임계값 튜닝이 불필요하다.
>
> **참고 (v8)**: `maxLogSizeBytes` 제거됨. SQLite는 파일 로테이션이 불필요하며,
> `retentionDays`에 따른 `pruneOldEvents()`로 데이터 정리를 수행한다.
> `dbPath`, `embedding` 설정이 추가되었다.

---

## 10. 프라이버시 및 보안

### 10.1 원칙

| 원칙 | 구현 |
|------|------|
| 로컬 전용 | 모든 데이터는 `~/.self-generation/data/self-gen.db` (SQLite)에만 저장 |
| 네트워크 전송 없음 | 분석은 로컬에서만 실행, 외부 API 호출 없음 |
| 최소 수집 | 도구 입력의 전체가 아닌 메타 정보만 기록 |
| 삭제 가능 | `rm ~/.self-generation/data/self-gen.db*`로 완전 삭제 (WAL/SHM 포함) |

### 10.2 보안 고려사항

```
수집하는 것:
  ✓ 프롬프트 원문 (설정으로 비활성화 가능)
  ✓ 도구 이름
  ✓ 파일 경로 (Read/Write/Edit)
  ✓ Bash 실행 커맨드의 첫 단어만
  ✓ 에러 메시지 (경로/숫자 정규화)

수집하지 않는 것:
  ✗ Bash 실행 커맨드의 전체 인자 (비밀번호, 토큰 등 노출 방지)
  ✗ 파일 내용
  ✗ 도구 응답 본문
  ✗ 환경 변수
  ✗ .env, credentials 등 민감 파일 경로
```

### 10.3 데이터 최소화 모드

`config.json`에서 `collectPromptText: false` 설정 시:

```sql
-- events 테이블의 data JSON 컬럼에 text가 "[REDACTED]"로 저장됨
INSERT INTO events (v, type, ts, session_id, project, project_path, data)
VALUES (1, 'prompt', '...', 'abc', 'my-app', '/path/to/my-app',
  '{"text":"[REDACTED]","charCount":25}');
```

### 10.4 데이터 위치

전역 `~/.self-generation/`은 홈 디렉토리에 있으므로 프로젝트 git에 포함되지 않는다.
별도의 gitignore 설정이 불필요하다. SQLite DB 파일(`self-gen.db`)과 WAL/SHM 파일이 `data/` 디렉토리에 저장된다.

---

## 11. 구현 로드맵

### Phase 1: 데이터 수집

```
목표: self-gen.db events 테이블에 이벤트가 쌓이는 것까지

작업:
  1. ~/.self-generation/ 디렉토리 구조 생성
  2. npm init + better-sqlite3, sqlite-vec 의존성 설치
  3. lib/db.mjs (SQLite 연결, 스키마 초기화, WAL 모드)
  4. hooks/prompt-logger.mjs (UserPromptSubmit)
  5. hooks/tool-logger.mjs (PostToolUse)
  6. hooks/error-logger.mjs (PostToolUseFailure)
  7. hooks/session-summary.mjs (SessionEnd, 요약만)
  8. ~/.claude/settings.json에 훅 등록
  9. 테스트: 실제 세션에서 DB 수집 확인

산출물:
  - ~/.self-generation/data/self-gen.db (이벤트 수집 시작)
```

### Phase 2: AI 기반 패턴 분석

```
목표: claude --print로 수집 데이터를 분석하고 제안 생성

작업:
  1. prompts/analyze.md (AI 분석 프롬프트 템플릿)
  2. lib/ai-analyzer.mjs (claude --print 실행, analysis_cache 테이블 저장)
  3. bin/analyze.mjs (CLI 분석 도구)
  4. hooks/session-summary.mjs 확장 (AI 분석 비동기 트리거 + Transformers.js 배치 임베딩 생성)
  5. hooks/session-analyzer.mjs (SessionStart DB 캐시 주입)
  6. 테스트: 실제 데이터로 AI 분석 결과 검증

산출물:
  - CLI로 AI 기반 온디맨드 패턴 분석 가능
  - 세션 종료 시 자동 분석 → 다음 세션 시작 시 제안 주입
  - 에러 KB 임베딩 배치 생성 (벡터 검색 준비)
```

### Phase 3: 제안 적용

```
목표: AI가 생성한 제안을 실행 가능한 개선으로 적용

작업:
  1. bin/apply.mjs (제안 적용 CLI, AI 캐시에서 읽기)
  2. bin/dismiss.mjs (제안 거부 기록)
  3. 커스텀 스킬 자동 생성 (.claude/commands/*.md)
  4. CLAUDE.md 자동 업데이트
  5. 테스트: 제안 → 승인 → 적용 E2E 플로우

산출물:
  - AI가 설계한 커스텀 스킬
  - AI가 작성한 CLAUDE.md 규칙
  - 적용/거부 CLI
```

### Phase 4: 피드백 루프

```
목표: 피드백을 AI 분석에 반영하여 제안 품질 향상

작업:
  1. lib/feedback-tracker.mjs (채택/거부 추적 + 요약 생성, feedback 테이블)
  2. AI 분석 프롬프트에 피드백 요약 주입
  3. 테스트: 피드백 반영 후 제안 품질 변화 확인

산출물:
  - feedback 테이블 (피드백 기록)
  - AI가 사용자 선호도를 학습하는 자기 개선 사이클
```

### Phase 5: 실시간 어시스턴스

```
목표: 세션 내 즉시 도움 제공 (배치 분석의 보완)

작업:
  1. lib/error-kb.mjs (에러 KB 벡터 검색/기록, error_kb 테이블)
  2. lib/skill-matcher.mjs (벡터 기반 스킬-프롬프트 매칭, skill_embeddings 테이블)
  3. hooks/error-logger.mjs 확장 (에러 KB 실시간 벡터 검색)
  4. hooks/prompt-logger.mjs 확장 (스킬 자동 감지)
  5. hooks/subagent-tracker.mjs (서브에이전트 성능 추적)
  6. hooks/session-analyzer.mjs 확장 (이전 세션 컨텍스트 주입)
  7. 테스트: 에러 재발 시 KB 즉시 안내 확인 (벡터 + 텍스트 폴백)

산출물:
  - 에러 발생 즉시 벡터 유사도 기반 해결 이력 안내
  - 벡터 기반 기존 스킬 자동 추천
  - 세션 간 컨텍스트 연속성
  - 서브에이전트 사용 최적화 데이터
```

### 최종 산출물 요약

```
입력                              분석                    출력
────────────────                  ──────                  ──────────────────

[배치 분석 (세션 간)]
프롬프트 (UserPromptSubmit)  ─┐
도구 사용 (PostToolUse)      ─┼─→  claude --print  ─→  커스텀 스킬
도구 에러 (PostToolUseFailure)┤    (AI 의미 분석)       (.claude/commands/ 스킬)
세션 요약 (SessionEnd)       ─┤                    ─→  CLAUDE.md 지침
피드백 이력 (feedback 테이블) ─┘                   ─→  훅 워크플로우
                              │
                              └─→  배치 임베딩 생성 — Transformers.js (error_kb, skill_embeddings)

[실시간 어시스턴스 (세션 내)]
에러 발생 ─────────────────→ 벡터 유사도 KB 검색 ──→  즉시 해결 제안
프롬프트 입력 ─────────────→ 벡터 스킬 매칭     ──→  기존 스킬 안내
서브에이전트 종료 ─────────→ 성능 추적          ──→  사용 최적화 데이터
세션 시작 ─────────────────→ 이전 세션          ──→  컨텍스트 연속성
```

### 검증 이력 요약

v1~v4 설계 과정에서 총 4회의 Opus 아키텍트 검증을 수행하여 27건의 결함을 발견하고 전량 수정했다.

| 차수 | 대상 | 결함 수 | 최고 심각도 | 판정 |
|:----:|------|:------:|:----------:|:----:|
| 1차 | v1 | 10건 | HIGH | - |
| 2차 | v2 (API 검증 포함) | 7건 | HIGH | - |
| 3차 | v3 | 5건 | MEDIUM | PASS |
| 4차 | v4 | 5건 | MEDIUM | PASS |

1차(HIGH 4건) → 4차(HIGH 0건)로 심각도 지속 감소. 3차부터 구현 진행 가능 판정.

v6 이후 추가 검증에서 2건의 HIGH 구조적 결함(recordResolution 미연결, getFeedbackSummary 미연결)을 발견하고 수정했다.

v2에서 식별된 잔여 리스크(Jaccard 한국어 튜닝, 대용량 JSONL, 일반 패턴 필터링 등)는 v5의 AI 분석 전환으로 대부분 해소되었다. 향후 개선 후보로 제안된 워크플로우 자동 적용(P6), SessionStart source 활용(P7), SessionEnd reason 활용(P8), tool_response 활용은 v7에서 구현되었다. v8에서 JSONL 저장소를 SQLite + sqlite-vec로 전환하여 대용량 JSONL 리스크를 완전히 해소하고, 벡터 유사도 검색 기능을 추가했다.

---

## 부록: 대안 검토

### A) 분석 엔진: 정적 분석 vs AI 에이전트 (v5에서 재검토)

| 기준 | 정적 분석 (v1-v4) | `claude --print` (v5, 선택) |
|------|-------------------|---------------------------|
| 의미 유사도 | Jaccard (키워드 겹침만) | 완전한 의미 이해 |
| 한국어 지원 | 공백 분할 (형태소 분석 없음) | 네이티브 수준 |
| 에러 규칙 도출 | 6개 하드코딩 | 무제한 (자유 생성) |
| 코드 복잡도 | 5개 모듈, ~400줄 | 1개 모듈 + 프롬프트 템플릿 |
| 실행 비용 | 0원 | ~$0.01-0.05/회 |
| 실행 시간 | <500ms | 10-30초 (백그라운드) |
| 외부 의존성 | 없음 | `claude` CLI |

**결론 (v5)**: AI 분석으로 전환. 비용 대비 분석 품질 향상이 압도적이며,
특히 한국어/영어 혼용 환경에서 정적 분석의 한계가 명확했다.
비동기 실행(SessionEnd)으로 UX 영향 없음.

### B) 저장소: JSONL vs SQLite

| 기준 | JSONL (v1-v7) | SQLite + sqlite-vec (v8, 선택) |
|------|-------------|--------|
| 의존성 | 없음 | better-sqlite3, sqlite-vec |
| 쿼리 | 순차 스캔 | 인덱스 지원 |
| 동시성 | append 안전 | WAL 모드 (읽기/쓰기 동시) |
| 적합 규모 | ~100K 이벤트 | 100K+ |
| 벡터 검색 | 불가 | sqlite-vec 코사인 유사도 |
| 데이터 관리 | 파일 로테이션 필요 | DELETE WHERE로 간단 정리 |

**결론 (v8)**: SQLite + sqlite-vec로 전환. 벡터 유사도 검색 요구사항 추가,
인덱스 기반 쿼리 성능, WAL 동시성, 단일 파일 관리의 이점이
`better-sqlite3` + `sqlite-vec` 2개 의존성 추가를 정당화한다.

### C) 커스텀 스킬 저장 위치

| 범위 | 경로 | 용도 |
|------|------|------|
| 프로젝트 | `.claude/commands/*.md` | 프로젝트 특화 스킬 (git 공유 가능) |
| 글로벌 | `~/.claude/commands/*.md` | 모든 프로젝트 공통 스킬 |

**결론**: 프로젝트 특화 패턴은 프로젝트 스킬로, 범용 패턴은 글로벌 스킬로 생성. 자동 트리거가 필요하면 SessionStart 훅에서 additionalContext로 안내.

---

## 부록 C: Claude Code Hooks API 참조

> 소스: Claude Code 공식 문서 (code.claude.com/docs/en/hooks)
> 확인일: 2026-02-07

### C.1 전체 훅 이벤트 목록 (12개)

| 이벤트 | 시점 | matcher 대상 |
|--------|------|-------------|
| `SessionStart` | 세션 시작/재개 | `source`: startup, resume, clear, compact |
| `UserPromptSubmit` | 사용자 프롬프트 제출 | matcher 없음 |
| `PreToolUse` | 도구 실행 전 | `tool_name` |
| `PermissionRequest` | 권한 대화상자 표시 | `tool_name` |
| `PostToolUse` | 도구 성공 후 | `tool_name` |
| `PostToolUseFailure` | 도구 실패 후 | `tool_name` |
| `Notification` | 알림 전송 | 알림 유형 |
| `SubagentStart` | 서브에이전트 시작 | 에이전트 유형 |
| `SubagentStop` | 서브에이전트 종료 | 에이전트 유형 |
| `Stop` | Claude 응답 완료 | matcher 없음 |
| `PreCompact` | 컨텍스트 압축 전 | manual, auto |
| `SessionEnd` | 세션 종료 | `reason`: clear, logout, prompt_input_exit, other |

### C.2 Hook stdin 공통 필드

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse"
}
```

### C.3 이벤트별 추가 stdin 필드

| 이벤트 | 추가 필드 |
|--------|----------|
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| `PostToolUseFailure` | `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt` |
| `SessionStart` | `source`, `model`, `agent_type` (선택) |
| `SessionEnd` | `reason` |
| `Stop` | `stop_hook_active` |
| `SubagentStart` | `agent_id`, `agent_type` |
| `SubagentStop` | `agent_id`, `agent_type`, `agent_transcript_path` |

### C.4 Hook stdout 출력 형식

```json
{
  "continue": true,
  "stopReason": "사유 (continue=false 시)",
  "suppressOutput": false,
  "systemMessage": "사용자에게 표시할 경고",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Claude에게 주입할 컨텍스트 문자열"
  }
}
```

### C.5 Hook 등록 형식 (settings.json)

```json
{
  "hooks": {
    "이벤트명": [
      {
        "matcher": "정규식 (선택, 이벤트별 대상 다름)",
        "hooks": [
          {
            "type": "command",
            "command": "실행할 명령어",
            "timeout": 5,
            "async": false
          }
        ]
      }
    ]
  }
}
```

**timeout 단위**: **초(seconds)**. 기본값: command=600초, prompt=30초, agent=60초.

**async**: `true`면 백그라운드 실행 (command 타입만 지원). 비동기 훅은 결정 필드 무효.

**matcher 미지원 이벤트**: `UserPromptSubmit`, `Stop`은 matcher 필드를 무시함 (생략 권장).

**실행 순서**: 동일 이벤트의 여러 훅은 **병렬 실행**. 순차 실행은 미지원.

### C.6 환경 변수

| 변수 | 사용 가능 이벤트 | 설명 |
|------|----------------|------|
| `CLAUDE_PROJECT_DIR` | 모든 이벤트 | 프로젝트 루트 디렉토리 |
| `CLAUDE_ENV_FILE` | SessionStart만 | 환경변수 영속화 파일 경로 |

### C.7 종료 코드

| 코드 | 의미 |
|------|------|
| 0 | 성공, stdout JSON 처리됨 |
| 2 | 블로킹 에러 (이벤트에 따라 다름) |
| 기타 | 비블로킹 에러, stderr는 verbose 모드에서 표시 |
