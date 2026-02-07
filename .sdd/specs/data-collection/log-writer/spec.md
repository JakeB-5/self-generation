---
id: log-writer
title: "log-writer"
status: draft
created: 2026-02-07
domain: data-collection
depends: "better-sqlite3, sqlite-vec"
constitution_version: "2.0.0"
---

# log-writer

> 데이터베이스 관리 모듈 (`lib/db.mjs`). 모든 데이터 수집 훅의 기반이 되는 공통 라이브러리로, SQLite DB 연결 관리, 이벤트 삽입/조회/삭제, 설정 로딩, stdin JSON 파싱, 임베딩 생성 및 벡터 검색 기능을 제공한다.

---

## Requirement: REQ-DC-001 — 이벤트 삽입 (insertEvent)

시스템은 이벤트 데이터를 `events` 테이블에 INSERT(SHALL)해야 한다. 각 이벤트는 공통 필드(`v`, `type`, `ts`, `session_id`, `project`, `project_path`)와 타입별 데이터(`data` JSON 컬럼)로 구성된다.

### Scenario: 정상 이벤트 삽입

- **GIVEN** `~/.self-generation/data/self-gen.db` 데이터베이스가 초기화된 상태
- **WHEN** `insertEvent(entry)`를 호출하면
- **THEN** `events` 테이블에 새 행이 INSERT(SHALL)된다. `entry`의 공통 필드는 각 컬럼에, 나머지 타입별 필드는 `data` JSON 컬럼에 저장된다

### Scenario: 데이터베이스 자동 초기화

- **GIVEN** `~/.self-generation/data/self-gen.db` 파일이 존재하지 않는 상태
- **WHEN** `insertEvent()`가 호출되면
- **THEN** `getDb()`를 통해 DB가 자동 생성 및 초기화(SHALL)된 후 이벤트가 삽입된다

### Scenario: 스키마 버전 포함

- **GIVEN** 어떤 훅에서든 이벤트를 생성할 때
- **WHEN** `insertEvent()`로 기록하면
- **THEN** 모든 이벤트에 `v: 1` 값이 포함(SHALL)되어야 한다

---

## Requirement: REQ-DC-002 — 이벤트 조회 (queryEvents)

시스템은 `events` 테이블에서 다양한 필터 조건으로 이벤트를 조회(SHALL)할 수 있어야 한다. 필터 조건: `type`, `sessionId`, `project`, `projectPath`, `since` (타임스탬프), `limit`.

### Scenario: 필터 조건으로 이벤트 조회

- **GIVEN** `events` 테이블에 여러 세션, 프로젝트의 이벤트가 혼재된 상태
- **WHEN** `queryEvents({ type: 'prompt', sessionId: 'abc-123' })`을 호출하면
- **THEN** `WHERE type = ? AND session_id = ?` 파라미터화된 쿼리로 일치하는 이벤트만 반환(SHALL)된다

### Scenario: 최근 N개 제한 조회

- **GIVEN** `events` 테이블에 1000개 이상의 이벤트가 있는 상태
- **WHEN** `queryEvents({ limit: 100 })`을 호출하면
- **THEN** `ORDER BY ts DESC LIMIT 100`으로 최근 100개 이벤트만 반환(SHALL)된다

### Scenario: since 필터 조회

- **GIVEN** `events` 테이블에 다양한 시점의 이벤트가 있는 상태
- **WHEN** `since` 필터가 지정되면
- **THEN** `WHERE ts >= ?` 조건으로 해당 시점 이후의 이벤트만 반환(SHALL)된다

---

## Requirement: REQ-DC-003 — DB 초기화 (initDb)

시스템은 SQLite 데이터베이스의 테이블, 인덱스, WAL 모드를 초기화(SHALL)해야 한다. 로그 로테이션은 SQLite에서 불필요하므로 제거된다.

### Scenario: 최초 DB 생성 시 스키마 초기화

- **GIVEN** `self-gen.db` 파일이 존재하지 않거나 `events` 테이블이 없는 상태
- **WHEN** `initDb(db)`가 호출되면
- **THEN** 다음 SQL이 실행(SHALL)된다:
  ```sql
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
  ```

### Scenario: WAL 모드 활성화

- **GIVEN** DB 연결이 생성된 상태
- **WHEN** `initDb()`가 실행되면
- **THEN** `PRAGMA journal_mode=WAL`이 설정(SHALL)되어 동시 읽기/쓰기 성능이 향상된다

---

## Requirement: REQ-DC-004 — 보관 기한 초과 이벤트 삭제 (pruneOldEvents)

시스템은 보관 기한이 경과한 이벤트를 SQL DELETE로 삭제(SHALL)해야 한다. 매번 실행하지 않고 확률적으로(1%) 트리거한다.

### Scenario: 보관 기한 초과 이벤트 정리

- **GIVEN** `events` 테이블에 90일 이전의 이벤트가 존재하는 상태
- **WHEN** `pruneOldEvents(retentionDays)`가 트리거되면
- **THEN** `DELETE FROM events WHERE ts < datetime('now', '-N days')` SQL이 실행(SHALL)되어 해당 이벤트가 삭제된다

### Scenario: 확률적 트리거

- **GIVEN** `insertEvent()`가 호출될 때
- **WHEN** `Math.random() < 0.01` 조건이 참이면
- **THEN** `pruneOldEvents(retentionDays)`가 실행(SHALL)된다 (약 100회 기록마다 1회)

---

## Requirement: REQ-DC-005 — 설정 파일 스키마 및 기본값

시스템은 `~/.self-generation/config.json` 파일의 설정 스키마를 정의해야 한다(SHALL).

### 설정 필드

- `enabled` (boolean, 기본값: true): 시스템 전체 활성화 여부
- `collectPromptText` (boolean, 기본값: true): 프롬프트 원문 수집 여부
- `retentionDays` (number, 기본값: 90): 이벤트 보관 기한 (일)
- `dbPath` (string, 기본값: `~/.self-generation/data/self-gen.db`): SQLite DB 파일 경로
- `analysisOnSessionEnd` (boolean, 기본값: true): 세션 종료 시 AI 분석 자동 실행 여부
- `analysisDays` (number, 기본값: 7): AI 분석 대상 기간 (일)
- `analysisCacheMaxAgeHours` (number, 기본값: 24): AI 분석 캐시 유효 기간 (시간)
- `embedding` (object, 기본값: `{ model: 'claude', dimensions: 384 }`): 임베딩 생성 설정

### Scenario 1: config.json 미존재 시 기본값 사용

- **GIVEN** `~/.self-generation/config.json` 파일이 존재하지 않는 상태
- **WHEN** 훅 스크립트에서 설정을 읽으면
- **THEN** 위 기본값이 사용(SHALL)된다

### Scenario 2: enabled=false 시 수집 비활성화

- **GIVEN** `config.json`에서 `enabled: false`로 설정된 상태
- **WHEN** 데이터 수집 훅이 실행되면
- **THEN** 훅은 즉시 종료하고 어떤 데이터도 수집하지 않는다(SHALL)

### 비고

각 훅 스크립트에서 인라인으로 config를 로드함. 별도 `loadConfig` 유틸리티 함수는 DESIGN.md에 없으며, 각 훅이 직접 `fs.readFileSync`로 읽음.

---

## Requirement: REQ-DC-006 — stdin JSON 파싱 (readStdin)

시스템은 Claude Code Hook이 전달하는 stdin JSON 데이터를 동기적으로 읽고 파싱(SHALL)해야 한다.

### Scenario: 정상 stdin 읽기

- **GIVEN** Claude Code Hook이 JSON 데이터를 stdin으로 전달하는 상태
- **WHEN** `readStdin()`을 호출하면
- **THEN** 파싱된 JavaScript 객체가 반환(SHALL)된다

### Scenario: stdin 대용량 데이터 처리

- **GIVEN** 65KB 이상의 stdin 데이터가 전달되는 상태
- **WHEN** `readStdin()`이 실행되면
- **THEN** 64KB 버퍼를 반복 읽기하여 전체 데이터를 수집(SHALL)한 후 파싱한다

---

## Requirement: REQ-DC-007 — 싱글톤 DB 연결 (getDb)

시스템은 프로세스 내에서 단일 SQLite DB 연결을 싱글톤으로 관리(SHALL)해야 한다.

### Scenario: 최초 호출 시 DB 연결 생성

- **GIVEN** 프로세스에서 `getDb()`가 아직 호출되지 않은 상태
- **WHEN** `getDb()`를 호출하면
- **THEN** `better-sqlite3`를 사용하여 DB 연결을 생성하고, `initDb()`로 스키마를 초기화(SHALL)한 후 연결 객체를 반환한다

### Scenario: 재호출 시 기존 연결 반환

- **GIVEN** `getDb()`가 이미 호출되어 연결이 존재하는 상태
- **WHEN** `getDb()`를 다시 호출하면
- **THEN** 새 연결을 생성하지 않고 기존 연결 객체를 반환(SHALL)한다

### Scenario: WAL 모드 및 sqlite-vec 로드

- **GIVEN** DB 연결이 최초 생성되는 상태
- **WHEN** `getDb()` 내부에서 초기화가 수행되면
- **THEN** `PRAGMA journal_mode=WAL`을 설정하고, `sqlite-vec` 확장을 로드(SHALL)한다

---

## Requirement: REQ-DC-008 — 임베딩 생성 (generateEmbeddings)

시스템은 텍스트 배열을 입력받아 Transformers.js `paraphrase-multilingual-MiniLM-L12-v2` 모델을 통해 벡터 임베딩을 배치 생성(SHALL)해야 한다. 이 함수는 비동기(async)로 동작한다.

### Scenario: 텍스트 배열 임베딩 생성

- **GIVEN** 임베딩이 필요한 텍스트 배열 `['에러 메시지 A', '에러 메시지 B']`가 주어진 상태
- **WHEN** `await generateEmbeddings(texts)`를 호출하면
- **THEN** Transformers.js `paraphrase-multilingual-MiniLM-L12-v2` 모델을 사용하여 각 텍스트에 대해 float[384] 벡터 배열을 반환(SHALL)한다

### Scenario: 빈 배열 입력

- **GIVEN** 빈 배열 `[]`이 입력된 상태
- **WHEN** `await generateEmbeddings([])`를 호출하면
- **THEN** 빈 배열 `[]`을 즉시 반환(SHALL)한다

---

## Requirement: REQ-DC-009 — 벡터 유사도 검색 (vectorSearch)

시스템은 임베딩 벡터를 사용하여 `sqlite-vec`의 vec0 가상 테이블을 통한 유사도 검색을 수행(SHALL)할 수 있어야 한다. 쿼리 임베딩은 `Buffer.from(new Float32Array(...).buffer)`로 변환하여 바인딩한다(SHALL).

### Scenario: 유사 이벤트 검색

- **GIVEN** vec0 가상 테이블에 임베딩이 저장된 상태
- **WHEN** `vectorSearch(table, vecTable, queryEmbedding, limit)`를 호출하면
- **THEN** vec0 가상 테이블에서 `MATCH` 연산자로 KNN 검색 후, 원본 테이블과 JOIN하여 가장 유사한 `limit`개의 결과를 반환(SHALL)한다

### Scenario: 결과 없음

- **GIVEN** vec0 가상 테이블이 비어있는 상태
- **WHEN** `vectorSearch(table, vecTable, queryEmbedding, limit)`를 호출하면
- **THEN** 빈 배열 `[]`을 반환(SHALL)한다

---

## Requirement: REQ-DC-010 — 세션 이벤트 조회 (getSessionEvents)

시스템은 특정 세션의 이벤트를 효율적으로 조회(SHALL)할 수 있어야 한다.

### Scenario: 세션 ID로 이벤트 조회

- **GIVEN** `events` 테이블에 여러 세션의 이벤트가 있는 상태
- **WHEN** `getSessionEvents(sessionId, limit)`를 호출하면
- **THEN** `WHERE session_id = ? ORDER BY ts DESC LIMIT ?` 쿼리로 해당 세션의 최근 이벤트만 반환(SHALL)된다

---

## 비고

- 이 모듈은 모든 데이터 수집 훅(`prompt-logger`, `tool-logger`, `error-logger`, `session-summary`)의 공통 의존성이다
- `better-sqlite3`와 `sqlite-vec`를 외부 의존성으로 사용한다
- `getProjectName(cwd)`: cwd 경로의 마지막 디렉토리명을 반환 (표시용). 정규 식별에는 `projectPath` 사용 권장
- SQLite WAL 모드는 훅 프로세스 간 동시 쓰기 충돌을 방지한다
- JSONL 로테이션 관련 기능(`rotateIfNeeded`, `getLogFile`)은 SQLite 전환으로 제거되었다
