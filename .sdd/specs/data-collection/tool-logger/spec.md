---
id: tool-logger
title: "tool-logger"
status: draft
created: 2026-02-07
domain: data-collection
depends: "data-collection/log-writer, realtime-assist/error-kb"
constitution_version: "2.0.0"
---

# tool-logger

> PostToolUse 훅 스크립트 (`hooks/tool-logger.mjs`). 도구 사용을 기록하고, 이전 에러가 해결되었는지 감지하여 에러 KB에 해결 이력을 기록한다. `error-kb.mjs`의 `recordResolution()`을 import하여 사용한다.

---

## Requirement: REQ-DC-201 — 도구 사용 기록

시스템은 PostToolUse 이벤트 발생 시 도구 사용 데이터를 `events` 테이블에 기록(SHALL)해야 한다. 공통 필드는 각 컬럼에, 도구 고유 필드(`tool`, `meta`, `success`)는 `data` JSON 컬럼에 저장된다.

### Scenario: 일반 도구 사용 기록

- **GIVEN** Claude Code가 도구를 성공적으로 실행한 상태
- **WHEN** PostToolUse 훅이 트리거되면
- **THEN** `insertEvent()`로 다음 필드를 포함하는 이벤트가 기록(SHALL)된다: `v: 1`, `type: 'tool_use'`, `ts`, `sessionId`, `project`, `projectPath`, `tool`, `meta`, `success: true`

### Scenario: stdin 필드 매핑

- **GIVEN** Claude Code가 stdin으로 `{ tool_name, tool_input, tool_response, session_id, cwd }`를 전달하는 상태
- **WHEN** 훅이 실행되면
- **THEN** `input.tool_name` → `tool`, `extractToolMeta(input.tool_name, input.tool_input)` → `meta`로 매핑(SHALL)된다

---

## Requirement: REQ-DC-202 — 도구별 메타데이터 추출 (extractToolMeta)

시스템은 도구 유형에 따라 프라이버시를 보호하면서 필요한 메타데이터만 추출(SHALL)해야 한다.

### Scenario: Bash 명령어 — 첫 단어만 저장

- **GIVEN** Bash 도구가 `npm install express --save` 명령어를 실행한 상태
- **WHEN** `extractToolMeta('Bash', { command: 'npm install express --save' })`가 호출되면
- **THEN** `{ command: 'npm' }`만 반환(SHALL)된다 (전체 인자는 프라이버시를 위해 저장하지 않음)

### Scenario: 파일 조작 도구 — 파일 경로 저장

- **GIVEN** Read, Write, Edit 도구가 사용된 상태
- **WHEN** `extractToolMeta('Read', { file_path: '/src/index.ts' })`가 호출되면
- **THEN** `{ file: '/src/index.ts' }`가 반환(SHALL)된다

### Scenario: 민감 파일 경로 마스킹

- **GIVEN** 파일 경로가 민감 패턴(`.env`, `.env.*`, `credentials.json`, `*.key`, `*.pem`, `id_rsa*`)에 매칭되는 상태
- **WHEN** `extractToolMeta('Read', { file_path: '/app/.env' })`가 호출되면
- **THEN** `{ file: '[SENSITIVE_PATH]' }`로 마스킹되어 반환(SHALL)된다

### Scenario: 민감 파일 패턴 목록

시스템은 다음 패턴을 민감 파일로 판단(SHALL)해야 한다:
- `.env` (정확한 파일명 또는 경로 구성 요소)
- `.env.*` (`.env.local`, `.env.production` 등)
- `credentials.json`
- `*.key` (예: `private.key`, `api.key`)
- `*.pem` (예: `cert.pem`, `key.pem`)
- `id_rsa*` (예: `id_rsa`, `id_rsa.pub`)

### Scenario: Task 도구 — 에이전트 정보 저장

- **GIVEN** Task 도구가 서브에이전트를 생성한 상태
- **WHEN** `extractToolMeta('Task', { subagent_type: 'executor', model: 'sonnet' })`가 호출되면
- **THEN** `{ agentType: 'executor', model: 'sonnet' }`이 반환(SHALL)된다

### Scenario: 검색 도구 — 패턴 저장

- **GIVEN** Grep 또는 Glob 도구가 사용된 상태
- **WHEN** `extractToolMeta('Grep', { pattern: 'TODO.*fix' })`가 호출되면
- **THEN** `{ pattern: 'TODO.*fix' }`가 반환(SHALL)된다

### Scenario: 알 수 없는 도구

- **GIVEN** 매핑되지 않은 도구가 사용된 상태
- **WHEN** `extractToolMeta('UnknownTool', ...)`가 호출되면
- **THEN** 빈 객체 `{}`가 반환(SHALL)된다

### Scenario: toolInput이 null/undefined

- **GIVEN** `toolInput`이 없는 상태
- **WHEN** `extractToolMeta(tool, null)`가 호출되면
- **THEN** 빈 객체 `{}`가 반환(SHALL)된다

---

## Requirement: REQ-DC-203 — 동일 도구 해결 감지 (Same-tool Resolution)

시스템은 동일 세션 내에서 에러가 발생한 도구가 이후 성공하면 해결로 감지(SHALL)하고 에러 KB에 기록해야 한다. 성능 제한으로 최근 50개 이벤트만 조회한다.

### Scenario: Bash 에러 후 동일 Bash 성공

- **GIVEN** `queryEvents({ sessionId, limit: 50 })`으로 현재 세션의 최근 50개 이벤트를 시간순 정렬한 상태에서, 세션 내에서 Bash 도구가 `tool_error`를 발생시킨 이력이 있는 상태
- **WHEN** 이후 동일 세션에서 Bash 도구가 성공적으로 실행되면
- **THEN** `recordResolution(lastError.error, { tool, sessionId, resolvedBy: 'success_after_error', errorRaw, filePath, toolSequence, promptContext })`를 호출(SHALL)한다

### Scenario: 풍부한 해결 컨텍스트 (v7 P11)

- **GIVEN** 에러와 성공 사이에 3개의 도구가 사용된 상태
- **WHEN** 해결이 감지되면
- **THEN** `toolSequence`에 에러 이후 최대 5개 도구 사용 기록이 포함(SHALL)되고, `promptContext`에 마지막 프롬프트의 처음 200자가 포함(SHALL)된다

### Scenario: 세션 스코프 제한

- **GIVEN** 이전 세션에서 Bash 에러가 발생한 이력이 있는 상태
- **WHEN** 현재 세션에서 Bash가 성공하면
- **THEN** 다른 세션의 에러는 해결 대상으로 고려하지 않는다(SHALL)

---

## Requirement: REQ-DC-204 — 크로스 도구 해결 감지 (Cross-tool Resolution)

시스템은 한 도구의 에러가 다른 도구의 도움으로 해결되는 패턴을 감지(SHOULD)해야 한다.

### Scenario: Bash 실패 → Edit 수정 → Bash 성공 패턴

- **GIVEN** 세션에서 Bash(fail) → Edit(success) → Bash(success) 시퀀스가 발생한 상태
- **WHEN** 마지막 Bash 성공이 기록되면
- **THEN** `recordResolution(bashError, { tool: bashError.tool, sessionId, resolvedBy: 'cross_tool_resolution', errorRaw, helpingTool: 'Edit', filePath, toolSequence })`를 호출(SHOULD)한다

### Scenario: 이미 해결된 에러 무시

- **GIVEN** 에러 발생 후 원래 도구가 이미 성공한 적이 있는 상태
- **WHEN** 크로스 도구 해결을 감지하면
- **THEN** 현재 도구가 `helpingTools` 목록에 포함된 경우에만 기록(SHOULD)한다

---

## Requirement: REQ-DC-205 — Non-blocking 실행 보장

시스템은 해결 감지 실패를 포함한 모든 오류 상황에서 exit code 0으로 종료(SHALL)해야 한다.

### Scenario: 해결 감지 중 오류

- **GIVEN** `queryEvents` 또는 `recordResolution` 호출 중 예외가 발생하는 상태
- **WHEN** 해결 감지 로직에서 오류가 발생하면
- **THEN** 내부 try-catch로 포착하고 도구 사용 기록은 정상 완료(SHALL)한다 (해결 감지는 non-critical)

---

## Requirement: REQ-DC-206 — 시스템 활성화 체크

시스템은 훅 실행 초기에 `isEnabled()`를 확인하여 비활성화 시 즉시 종료(SHALL)해야 한다.

### Scenario: 시스템 비활성화

- **GIVEN** `config.json`에서 `enabled: false`로 설정된 상태
- **WHEN** 훅이 실행되면
- **THEN** `isEnabled()` 확인 후 즉시 `process.exit(0)`으로 종료(SHALL)한다

---

## 비고

- 해결 감지는 `queryEvents({ sessionId: input.session_id, limit: 50 })`으로 최근 50개 이벤트를 조회하여 O(n²) 방지
- 조회된 이벤트는 시간순 정렬 후 분석 (`.sort((a, b) => new Date(a.ts) - new Date(b.ts))`)
- `promptContext`: 해결 직전 마지막 프롬프트의 처음 200자를 저장하여 해결 맥락 파악에 활용
- `toolSequence`: 에러와 성공 사이의 최대 5개 도구 사용 기록
- `recordResolution`은 `error-kb.mjs` 모듈에서 import (`import { recordResolution } from '../lib/error-kb.mjs'`)
- 저장소가 JSONL에서 SQLite `events` 테이블로 변경됨. `db.mjs`의 `insertEvent()`와 `queryEvents()`를 사용한다
