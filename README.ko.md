[English](README.md)

# Self-Generation: Claude Code 자동 개선 시스템

Claude Code 사용 패턴을 자동 수집·분석하여 커스텀 스킬, CLAUDE.md 지침, 훅 워크플로우를 자동으로 제안하는 자기 개선 시스템입니다.

## 개요

Self-Generation은 Claude Code Hooks API를 통해 사용자의 프롬프트, 도구 사용, 에러를 수집하고, Claude 헤드리스 모드로 패턴을 분석하여 반복적인 작업을 자동화하는 데 필요한 커스텀 지침을 생성합니다.

- **대상 환경**: Vanilla Claude Code (플러그인 불필요)
- **배포 상태**: Phase 1~5 완료 (251개 테스트 통과)
- **핵심 특징**: 이중 계층 아키텍처 (배치 분석 + 실시간 보조)

## 주요 기능

- **자동 데이터 수집** — 프롬프트, 도구 사용 기록, 에러 로그를 8개 hook으로 실시간 수집
- **AI 패턴 분석** — Claude 헤드리스 모드로 반복 패턴 감지 (도구 시퀀스, 에러 패턴, 프롬프트 스타일)
- **에러 KB 벡터 검색** — 정규화된 에러 패턴을 384차원 벡터로 임베딩하여 유사 에러 찾기
- **스킬 자동 매칭** — 사용자 프롬프트와 기존 스킬을 벡터 유사도로 매칭하여 실시간 추천
- **커스텀 제안 생성** — 감지된 패턴으로부터 커스텀 스킬, CLAUDE.md 규칙, 훅 워크플로우 자동 생성

## 아키텍처

### 이중 계층 시스템

```
┌─────────────────────────────────────────────────────┐
│           Claude Code Session                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [실시간 보조 - Within Session]                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ • Error KB 벡터 검색                         │   │
│  │ • Skill 매칭 (prompt → best skill)          │   │
│  │ • Subagent 에러 패턴 주입                    │   │
│  │ • 파일별 에러 이력 표시                      │   │
│  └─────────────────────────────────────────────┘   │
│                    ↓                                 │
│  [8 Hook 이벤트 수집]                              │
│  UserPromptSubmit → PostToolUse → SessionEnd      │
│                                                     │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  [배치 분석 - Between Sessions]                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ • AI 패턴 분석 (헤드리스 모드)              │   │
│  │ • 커스텀 스킬 제안                           │   │
│  │ • CLAUDE.md 규칙 제안                        │   │
│  │ • 훅 워크플로우 제안                         │   │
│  │ • 배치 임베딩 (384-dim vectors)              │   │
│  └─────────────────────────────────────────────┘   │
│                    ↓                                 │
│  [제안 저장 → SessionStart에서 캐시 주입]         │
└─────────────────────────────────────────────────────┘
```

### Hook 이벤트 요약

| Event | Hook Script | Timeout | 목적 |
|-------|-------------|---------|------|
| `UserPromptSubmit` | prompt-logger.mjs | 5s | 프롬프트 수집 + 스킬 매칭 |
| `PostToolUse` | tool-logger.mjs | 5s | 도구 사용 + 해결 감지 |
| `PostToolUseFailure` | error-logger.mjs | 5s | 에러 수집 + KB 검색 |
| `PreToolUse` | pre-tool-guide.mjs | 5s | 파일별 에러 이력 표시 |
| `SubagentStart` | subagent-context.mjs | 5s | 에러 패턴 + AI 규칙 주입 |
| `SubagentStop` | subagent-tracker.mjs | 5s | 에이전트 성능 추적 |
| `SessionEnd` | session-summary.mjs | 10s | 요약 + AI 분석 트리거 + 배치 임베딩 |
| `SessionStart` | session-analyzer.mjs | 10s | 캐시 주입 + 임베딩 데몬 시작 |

## 빠른 시작

### 필수 조건

- **Node.js >= 18** (v22 권장, v24는 native build 호환성 문제)
- **MacOS / Linux** (Windows는 WSL2 필요)
- **claude CLI** 설치됨 (`claude --version` 확인)

### 설치

```bash
# 1. 저장소 클론
git clone https://github.com/JakeB-5/self-generation.git
cd self-generation

# 2. 의존성 설치
npm install

# 3. 시스템 설치 (hooks 등록, 디렉토리 생성)
node bin/install.mjs
```

### 검증

```bash
# 모든 테스트 실행 (251개)
npm test

# 에러 발생 시 전체 제거 후 재설치
node bin/install.mjs --uninstall --purge
node bin/install.mjs
```

## 사용법

### 자동 분석 (Hook 기반)

설치 후 Claude Code를 평소처럼 사용하면 됩니다. 모든 분석이 자동으로 실행됩니다:

1. **세션 중** — 8개 hook이 프롬프트, 도구 사용, 에러를 자동 수집
2. **세션 종료 시** — `SessionEnd` hook이 AI 패턴 분석을 백그라운드로 트리거
3. **다음 세션 시작 시** — `SessionStart` hook이 분석 결과와 제안을 자동 주입

별도 조작 없이 세션을 사용하는 것만으로 데이터가 축적되고 제안이 생성됩니다.

### 수동 분석 (CLI)

특정 조건으로 분석을 직접 실행할 수도 있습니다:

```bash
# 기본: 지난 30일 이벤트 분석
node bin/analyze.mjs

# 특정 기간 분석
node bin/analyze.mjs --days 60

# 특정 프로젝트만 분석
node bin/analyze.mjs --project my-project

# 특정 프로젝트 경로로 필터링
node bin/analyze.mjs --project-path /path/to/project
```

출력: 감지된 패턴별 제안 목록 (번호 매김)

### 제안 적용

```bash
# 제안 #3 미리보기 (자동 적용 아님)
node bin/apply.mjs 3

# 제안 #3을 프로젝트 CLAUDE.md에 적용
node bin/apply.mjs 3 --apply

# 제안 #3을 전역 ~/.claude/CLAUDE.md에 적용 (--global)
node bin/apply.mjs 3 --global --apply

# 특정 프로젝트에만 적용
node bin/apply.mjs 3 --project my-project --apply
```

### 제안 거절

```bash
# 제안 #3을 거절 (피드백 기록)
node bin/dismiss.mjs suggestion-id-3
```

거절된 제안은 향후 분석에서 제외됩니다.

## 출력 유형

Self-Generation은 감지된 패턴에 따라 3가지 유형의 제안을 생성합니다.

| 출력 | 생성 시 | 저장 위치 | 예시 |
|------|--------|---------|------|
| **커스텀 스킬** | 반복 도구 시퀀스 감지 | `~/.claude/commands/*.md` | "데이터 분석" 스킬 (pandas 관련 도구들) |
| **CLAUDE.md 규칙** | 반복 지침/패턴 감지 | `.claude/CLAUDE.md` (프로젝트) 또는 `~/.claude/CLAUDE.md` (전역) | "항상 테스트부터" 규칙 |
| **훅 워크플로우** | 반복 이벤트 시퀀스 감지 | `~/.self-generation/hooks/auto/` | "에러 발생 → 해결" 자동화 |

## 프로젝트 구조

```
self-generation/
├── README.md                      # 이 파일
├── CLAUDE.md                      # 프로젝트 가이드
├── DESIGN.md                      # 완전한 시스템 스펙 (SSOT)
├── package.json                   # 의존성
├── bin/
│   ├── install.mjs               # 설치/제거/초기화
│   ├── analyze.mjs               # AI 분석 실행
│   ├── apply.mjs                 # 제안 적용
│   └── dismiss.mjs               # 제안 거절
├── lib/
│   ├── db.mjs                    # SQLite DB 관리
│   ├── ai-analyzer.mjs           # Claude 헤드리스 모드 래퍼
│   ├── error-kb.mjs              # 에러 KB 벡터 검색
│   ├── skill-matcher.mjs         # 스킬 매칭
│   ├── feedback-tracker.mjs      # 피드백 추적
│   ├── embedding-server.mjs      # 임베딩 데몬
│   ├── embedding-client.mjs      # 데몬 클라이언트
│   └── batch-embeddings.mjs      # 배치 임베딩
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
│   ├── constitution.md           # 프로젝트 원칙
│   ├── domains.yml               # 도메인 구조
│   └── specs/                    # 19개 SDD 스펙
└── tests/
    └── *.test.mjs                # 251개 테스트 (47개 스위트)
```

## 기술 스택

| 계층 | 기술 | 버전 | 용도 |
|------|------|------|------|
| **런타임** | Node.js | >= 18 | ES Modules (`.mjs`) |
| **저장소** | SQLite | built-in | 로컬 DB |
| **저장소 확장** | sqlite-vec | ^0.1.0 | 벡터 유사도 검색 (384-dim) |
| **SQLite 바인딩** | better-sqlite3 | ^11.0.0 | Node.js ↔ SQLite |
| **임베딩** | @xenova/transformers | ^2.17.0 | paraphrase-multilingual-MiniLM-L12-v2 (384-dim, 오프라인) |
| **분석** | claude CLI | latest | Claude 헤드리스 모드 (AI 패턴 분석) |
| **Hook 시스템** | Claude Code Hooks API | built-in | `.claude/settings.json` |

## 개발

### 테스트 실행

```bash
# 모든 테스트 실행
npm test

# 특정 스위트만 실행
node --test tests/db.test.mjs
```

테스트 커버리지: 80%+ (SDD 요구사항)

### SDD 워크플로우

이 프로젝트는 Spec-Driven Development(SDD)를 따릅니다.

```
스펙 작성 (.sdd/specs/<domain>/<feature>/spec.md)
    ↓
테스트 작성 (tests/*.test.mjs)
    ↓
구현 (bin/*.mjs, lib/*.mjs, hooks/*.mjs)
    ↓
아키텍트 검증 (DESIGN.md 정합성)
    ↓
머지
```

모든 변경 사항은 RFC 2119 키워드(SHALL, SHOULD, MAY)를 포함한 스펙 문서가 필요합니다.

## 아키텍트 선택 기준

Self-Generation의 구현은 4개 주요 원칙을 기반으로 합니다:

1. **비차단 훅** — 모든 훅은 Claude Code 세션을 차단하지 않습니다 (exit code 0)
2. **전역 우선, 프로젝트 필터링** — 단일 SQLite DB에서 project_path로 필터링
3. **프라이버시** — 모든 데이터는 로컬(`~/.self-generation/`)에만 저장됨
4. **최소 의존성** — 정확히 3개 npm 패키지만 사용 (`better-sqlite3`, `sqlite-vec`, `@xenova/transformers`)

자세한 원칙은 [`.sdd/constitution.md`](.sdd/constitution.md)를 참조하세요.

## 참고 문서

- **`DESIGN.md`** — 완전한 시스템 스펙 (Single Source of Truth, 3869줄)
- **`CLAUDE.md`** — 프로젝트 가이드 및 build 명령어
- **`.sdd/constitution.md`** — 프로젝트 원칙 (v2.1.0)
- **`.sdd/specs/`** — 5개 도메인, 19개 상세 스펙

## 라이선스

MIT
