---
version: 2.1.0
created: 2026-02-07
updated: 2026-02-09
---

# Constitution: self-generation

> Claude Code 사용 패턴을 자동 수집·분석하여 커스텀 스킬, CLAUDE.md 지침, 훅 워크플로우를 자동 제안하는 자기 개선 시스템. 모든 설계와 구현은 아래 원칙을 준수해야 한다(SHALL).

## 핵심 원칙

### 1. 비차단 훅 (Non-blocking Hooks)

- 모든 훅 스크립트는 Claude Code 세션을 차단해서는 안 된다(SHALL NOT)
- 훅 실패 시 exit code 0으로 종료하여 세션에 영향을 주지 않아야 한다(SHALL)

### 2. 전역 우선, 프로젝트 필터링

- 모든 이벤트는 단일 SQLite DB(`self-gen.db`)의 `events` 테이블에 기록해야 한다(SHALL)
- 각 이벤트에 `project`(표시용)와 `project_path`(정규 식별자) 필드를 포함해야 한다(SHALL)
- 프로젝트별 필터링은 `project_path` 기반 SQL 쿼리로 수행해야 한다(SHALL)

### 3. 프라이버시 보호

- 모든 데이터는 로컬(`~/.self-generation/`)에만 저장해야 한다(SHALL)
- 수집된 데이터를 외부 서버로 전송해서는 안 된다(SHALL NOT)
- Bash 명령어는 첫 단어(명령어명)만 저장해야 한다(SHALL)
- 전체 인자나 민감 정보를 로그에 기록해서는 안 된다(SHALL NOT)
- 에러 메시지는 정규화하여 경로, 숫자, 문자열을 마스킹해야 한다(SHALL)

### 4. 스키마 버전 관리

- 모든 DB 엔트리에 `v` 필드를 포함해야 한다(SHALL)
- 스키마 변경 시 버전을 증가시켜야 한다(SHALL)

### 5. 품질 우선

- 모든 기능은 테스트와 함께 구현해야 한다(SHALL)
- 코드 리뷰 없이 머지해서는 안 된다(SHALL NOT)

### 6. 명세 우선

- 모든 기능은 스펙 문서가 먼저 작성되어야 한다(SHALL)
- 스펙은 RFC 2119 키워드를 사용해야 한다(SHALL)
- 모든 요구사항은 GIVEN-WHEN-THEN 시나리오를 포함해야 한다(SHALL)

### 7. 최소 의존성

- 외부 npm 패키지는 최소한으로 제한해야 한다(SHALL)
- 허용된 필수 패키지 3개: `better-sqlite3` (SQLite 바인딩), `sqlite-vec` (벡터 검색 확장), `@xenova/transformers` (오프라인 임베딩)
- 위 3개 이외의 외부 패키지를 추가해서는 안 된다(SHALL NOT)
- Node.js 내장 모듈(`fs`, `path`, `child_process` 등)을 우선 사용해야 한다(SHALL)

## 금지 사항

- 스펙 없이 기능을 구현해서는 안 된다(SHALL NOT)
- 테스트 없이 배포해서는 안 된다(SHALL NOT)
- 훅에서 동기적으로 `claude --print`를 호출해서는 안 된다(SHALL NOT) — 배치 분석은 반드시 비동기(백그라운드)로 실행
- 사용자 승인 없이 스킬, CLAUDE.md, 훅을 자동 적용해서는 안 된다(SHALL NOT)

## 기술 스택

- **런타임**: Node.js >= 18 (ES Modules, `.mjs`)
- **저장소**: SQLite (`better-sqlite3`) + `sqlite-vec` (벡터 확장), 단일 DB 파일 (`self-gen.db`), WAL 모드
- **임베딩**: `@xenova/transformers` + `paraphrase-multilingual-MiniLM-L12-v2` (384차원, 오프라인)
- **분석**: `claude --print` (AI 의미 기반 분석)
- **훅 시스템**: Claude Code Hooks API (`~/.claude/settings.json`)
- **설정**: JSON (`~/.self-generation/config.json`)

## 품질 기준

- 테스트 커버리지: 80% 이상(SHOULD)
- DESIGN.md가 구현의 단일 진실 소스(Single Source of Truth)이다(SHALL)
- 아키텍트 검증을 통과해야 구현을 진행할 수 있다(SHOULD)
