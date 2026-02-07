---
id: pre-tool-guide
title: "사전 예방 가이드 (Pre-Tool Guide)"
status: draft
created: 2026-02-07
domain: realtime-assist
depends: "data-collection/log-writer, realtime-assist/error-kb"
constitution_version: "2.0.0"
---

# pre-tool-guide

> `hooks/pre-tool-guide.mjs` — PreToolUse 훅 이벤트를 처리하여 Edit/Write, Bash, Task 도구 실행 전에 과거 에러 이력, 세션 내 Bash 에러, 서브에이전트 실패율 기반의 사전 경고/가이드를 Claude에게 주입하는 훅 스크립트.

---

## 개요

pre-tool-guide는 도구 실행 전에 과거 학습 데이터를 기반으로 사전 경고를 제공한다. 이를 통해 Claude가 이전에 발생한 에러를 반복하지 않고, 최적의 도구 사용 전략을 선택하도록 유도한다. Edit/Write, Bash, Task 도구에 대해서만 동작하며, 그 외 도구는 건너뛴다. 모든 데이터 조회는 SQLite 쿼리를 통해 수행한다.

### 파일 위치

- 훅 스크립트: `~/.self-generation/hooks/pre-tool-guide.mjs`
- 의존 데이터: `~/.self-generation/data/self-gen.db` (`events` 테이블, `error_kb` 테이블)

### 훅 등록

```json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": "node ~/.self-generation/hooks/pre-tool-guide.mjs"
      }]
    }]
  }
}
```

### 대상 도구 목록

| 도구 | 가이드 내용 |
|------|------------|
| Edit | 대상 파일 관련 과거 에러 이력 + 해결 방법 |
| Write | 대상 파일 관련 과거 에러 이력 + 해결 방법 |
| Bash | 현재 세션 내 Bash 에러 이력 + toolSequence 해결 경로 |
| Task | 요청된 서브에이전트 타입의 실패율 경고 (>30%) |

---

## 요구사항

### REQ-RA-301: Edit/Write 도구 — 파일 관련 에러 이력 주입

시스템은 Edit 또는 Write 도구 실행 전에, 대상 파일과 관련된 과거 에러 이력을 검색하여 Claude에게 주입해야 한다(SHALL).

1. `tool_input.file_path`에서 파일명을 추출하여 `events` 테이블의 `tool_error` 타입 엔트리 중 `data` JSON의 `errorRaw`에 해당 파일명이 포함된 최근 3건을 SQL로 조회 (SHALL)
   ```sql
   SELECT * FROM events
   WHERE type = 'tool_error'
     AND json_extract(data, '$.errorRaw') LIKE '%' || ? || '%'
   ORDER BY ts DESC LIMIT 3
   ```
2. 조회된 에러에 대해 `searchErrorKB()`로 KB 해결 이력을 검색 (SHALL)
3. KB 매치가 있으면 에러 패턴과 해결 방법을 `additionalContext`에 포함하여 stdout으로 출력 (SHALL)
4. 매치가 없으면 아무것도 출력하지 않는다(SHALL)

#### Scenario RA-301-1: 파일 관련 에러 이력이 존재할 때

- **GIVEN** `events` 테이블에 `src/index.ts` 관련 `tool_error` 엔트리가 있고, `error_kb`에 해결 이력이 있을 때
- **WHEN** `Edit` 도구가 `file_path: "/project/src/index.ts"`로 실행되기 전
- **THEN** `additionalContext`에 "이 파일 관련 과거 에러 이력: ..."과 "해결 방법: ..."이 포함된 JSON을 stdout으로 출력한다

#### Scenario RA-301-2: 파일 관련 에러 이력이 없을 때

- **GIVEN** `events` 테이블에 해당 파일 관련 에러가 없을 때
- **WHEN** `Write` 도구가 실행되기 전
- **THEN** stdout 출력 없이 exit 0으로 종료한다

---

### REQ-RA-302: Bash 도구 — 세션 내 에러 이력 주입

시스템은 Bash 도구 실행 전에, 현재 세션에서 발생한 Bash 에러 이력을 검색하여 Claude에게 주입해야 한다(SHALL).

1. `events` 테이블에서 현재 `session_id`와 일치하고 `type = 'tool_error'`이며 `json_extract(data, '$.tool') = 'Bash'`인 엔트리를 최근 100건에서 조회 (SHALL)
   ```sql
   SELECT * FROM events
   WHERE type = 'tool_error'
     AND session_id = ?
     AND json_extract(data, '$.tool') = 'Bash'
   ORDER BY ts DESC LIMIT 100
   ```
2. 에러가 있으면 가장 최근 에러로 `searchErrorKB()`를 호출 (SHALL)
3. KB 매치의 `tool_sequence`가 있으면 "이전 해결 경로"로 표시 (SHOULD)
4. 결과를 `additionalContext`에 포함하여 stdout으로 출력 (SHALL)

#### Scenario RA-302-1: 세션 내 Bash 에러가 존재하고 KB 매치됨

- **GIVEN** 현재 세션에서 Bash 에러 "permission denied"가 발생했고, `error_kb`에 `{ resolution: "sudo 사용", tool_sequence: '["Bash"]' }` 이력이 있을 때
- **WHEN** Bash 도구가 실행되기 전
- **THEN** `additionalContext`에 "이 세션에서 Bash 에러 발생 이력: ..."과 "이전 해결 경로: Bash"가 포함된다

#### Scenario RA-302-2: 세션 내 Bash 에러가 없을 때

- **GIVEN** 현재 세션에서 Bash 에러가 없을 때
- **WHEN** Bash 도구가 실행되기 전
- **THEN** Bash 관련 가이드는 출력하지 않는다

---

### REQ-RA-303: Task 도구 — 서브에이전트 실패율 경고

시스템은 Task 도구 실행 전에, 요청된 서브에이전트 타입의 최근 실패율을 확인하고 30%를 초과하면 경고해야 한다(SHALL).

1. `tool_input.subagent_type`으로 에이전트 타입을 확인 (SHALL)
2. `events` 테이블에서 해당 에이전트 타입의 최근 20건을 SQL 집계로 조회 (SHALL)
   ```sql
   SELECT
     COUNT(*) AS total,
     SUM(CASE WHEN json_extract(data, '$.success') = 0 THEN 1 ELSE 0 END) AS failures
   FROM (
     SELECT data FROM events
     WHERE type = 'subagent_stop'
       AND json_extract(data, '$.agentType') LIKE ?
     ORDER BY ts DESC
     LIMIT 20
   )
   ```
3. 최소 5건 이상 데이터가 있을 때만 실패율을 계산 (SHALL)
4. 실패율이 30%를 초과하면 실패율과 "더 높은 티어의 에이전트 사용을 고려하세요" 경고를 주입 (SHALL)
5. 실패율이 30% 이하이거나 데이터 부족 시 출력하지 않는다(SHALL)

#### Scenario RA-303-1: 실패율 30% 초과 경고

- **GIVEN** `events` 테이블에 `executor-low` 타입의 최근 20건 중 8건이 실패 (40%)
- **WHEN** Task 도구가 `subagent_type: "executor-low"`로 실행되기 전
- **THEN** `additionalContext`에 "executor-low 최근 실패율: 40% (20회 중 8회)" 및 티어 업그레이드 안내가 포함된다

#### Scenario RA-303-2: 데이터 부족 시 (5건 미만)

- **GIVEN** `events` 테이블에 해당 에이전트 타입의 기록이 3건뿐일 때
- **WHEN** Task 도구가 실행되기 전
- **THEN** 실패율 경고를 출력하지 않는다

#### Scenario RA-303-3: 실패율 30% 이하

- **GIVEN** `events` 테이블에 `executor` 타입의 최근 20건 중 2건만 실패 (10%)
- **WHEN** Task 도구가 `subagent_type: "executor"`로 실행되기 전
- **THEN** 실패율 경고를 출력하지 않는다

---

### REQ-RA-304: 대상 외 도구 건너뛰기

시스템은 Edit, Write, Bash, Task 이외의 도구에 대해서는 아무 처리 없이 즉시 종료해야 한다(SHALL).

#### Scenario RA-304-1: Read 도구 호출 시

- **GIVEN** PreToolUse 이벤트의 `tool_name`이 `"Read"`
- **WHEN** pre-tool-guide.mjs가 실행되면
- **THEN** 아무 출력 없이 exit 0으로 종료한다

---

### REQ-RA-305: 비차단 실행 보장

훅 스크립트는 어떤 상황에서도 exit 0으로 종료해야 한다(SHALL).

1. 전체 로직을 try-catch로 감싸야 한다(SHALL)
2. 예외 발생 시 `process.exit(0)`으로 종료 (SHALL)

#### Scenario RA-305-1: DB 접근 실패 시

- **GIVEN** `self-gen.db` 파일이 손상되어 접근 불가
- **WHEN** pre-tool-guide.mjs가 실행되면
- **THEN** exit code 0으로 정상 종료한다

---

## 비기능 요구사항

### 성능

- 훅 실행 시간은 2초 이내여야 한다(SHALL)
- SQL 쿼리는 인덱스를 활용하여 대용량 데이터에서도 빠르게 동작해야 한다(SHOULD)

### 출력 형식

- stdout 출력은 `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "..." } }` JSON 형태 (SHALL)
- `additionalContext` 문자열에 여러 가이드 항목을 개행(`\n`)으로 구분 (SHOULD)

---

## 제약사항

- `better-sqlite3` 패키지를 사용하여 SQLite 접근 (SHALL)
- `error-kb.mjs`의 `searchErrorKB()` 함수를 import하여 사용 (SHALL)
- `db.mjs`의 `readStdin()`, `getDb()`, `getProjectName()` 함수를 import하여 사용 (SHALL)

---

## 용어 정의

| 용어 | 정의 |
|------|------|
| PreToolUse | Claude Code에서 도구 실행 직전에 발생하는 훅 이벤트 |
| additionalContext | 훅이 Claude에게 주입하는 컨텍스트 문자열 |
| 실패율 (Failure Rate) | 서브에이전트의 최근 실행 중 실패한 비율 |
| tool_sequence | 에러 해결 시 사용된 도구의 순서 목록 |
| 티어 (Tier) | 서브에이전트의 성능/비용 등급 (low, medium, high) |
| SQL 집계 | events 테이블에 대한 GROUP BY/COUNT 쿼리로 통계를 산출하는 방식 |
