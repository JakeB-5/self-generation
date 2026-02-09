# 체크리스트: pre-tool-guide

## 스펙 완성도
- [ ] 모든 REQ에 GIVEN-WHEN-THEN 시나리오 포함
- [ ] RFC 2119 키워드 적절히 사용 (SHALL/SHOULD/MAY)
- [ ] depends 필드 정확: data-collection/log-writer, realtime-assist/error-kb

## DESIGN.md 일치

### REQ-RA-301: Edit/Write 도구 — 파일 관련 에러 이력 주입
- [ ] 설계 근거: PreToolUse는 동기 블로킹 훅이므로 벡터 검색 대신 텍스트 매칭만 사용
- [ ] `tool_input.file_path`에서 파일명 추출 (`filePath.split('/').pop()`)
- [ ] error_kb 테이블 직접 SQL 쿼리: `SELECT error_normalized, resolution FROM error_kb WHERE error_normalized LIKE ? AND resolution IS NOT NULL ORDER BY last_used DESC LIMIT 2` (`%${fileName}%` 바인딩)
- [ ] 가이드 표시: `⚠️ 이 파일 관련 과거 에러: ${kb.error_normalized}`, `해결 방법: ${res.resolvedBy} (${res.tool})`, `해결 경로: ${res.toolSequence.join(' → ')}`
- [ ] resolution JSON 파싱 실패 시 원본 문자열 표시
- [ ] 매치 없으면 가이드 출력하지 않음

### REQ-RA-302: Bash 도구 — 세션 내 에러 이력 주입
- [ ] 설계 근거: 벡터 검색 불필요. events 테이블에서 세션 내 에러 찾고, error_kb에서 정확 텍스트 매치만 수행
- [ ] events 테이블 쿼리: `SELECT json_extract(data, '$.error') AS error FROM events WHERE type = 'tool_error' AND session_id = ? AND json_extract(data, '$.tool') = 'Bash' ORDER BY ts DESC LIMIT 1`
- [ ] error_kb 정확 텍스트 매치: `SELECT error_normalized, resolution FROM error_kb WHERE error_normalized = ? AND resolution IS NOT NULL LIMIT 1`
- [ ] 가이드 표시: `💡 이 세션에서 Bash 에러 발생 이력: ${kbResult.error_normalized}`, `이전 해결 경로: ${resolution.toolSequence.join(' → ')}`
- [ ] 에러 없거나 KB 매치 없으면 가이드 출력하지 않음

### REQ-RA-303: Task 도구 — 서브에이전트 실패율 경고 (v9: 비활성화)
- [ ] v9 비활성화: SubagentStop API가 `error`/`success` 정보 미제공
- [ ] `success` 필드가 subagent_stop 이벤트에서 제거됨 (subagent-tracker.mjs 참조)
- [ ] 향후 SubagentStop API에 실패 정보 추가되면 `agent_transcript_path` 파싱으로 정확한 실패 판정 구현 후 복원 가능 (MAY)

### REQ-RA-304: 출력 형식
- [ ] 여러 가이드 항목을 개행(`\n`)으로 결합하여 `additionalContext`에 포함
- [ ] 가이드 항목 없으면 stdout 출력 없이 exit 0
- [ ] JSON: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "..." } }`

### REQ-RA-305: 비차단 실행 보장
- [ ] 전체 로직을 try-catch로 감싸기
- [ ] 예외 발생 시 `process.exit(0)`으로 종료

## 교차 참조

### data-collection/log-writer 인터페이스
- [ ] `queryEvents()`, `getDb()`, `readStdin()`, `isEnabled()` 함수 사용

### realtime-assist/error-kb 인터페이스
- [ ] error_kb 테이블 스키마 (error_normalized, resolution) 일치
- [ ] `searchErrorKB()` 사용하지 않음 (벡터 검색 회피, 성능 우선)

### subagent-tracker 동기화
- [ ] v9 success 필드 제거와 동기화 (REQ-RA-303 비활성화 배경)

## 테스트 계획

### Edit/Write 도구 테스트
- [ ] Scenario RA-301-1: 파일 관련 에러 이력 error_kb에 존재할 때 가이드 출력
- [ ] Scenario RA-301-2: 파일 관련 에러 이력 없을 때 가이드 생략

### Bash 도구 테스트
- [ ] Scenario RA-302-1: 세션 내 Bash 에러 존재하고 KB 정확 매치됨
- [ ] Scenario RA-302-2: 세션 내 Bash 에러 없을 때 가이드 생략
- [ ] Scenario RA-302-3: Bash 에러 있으나 KB 매치 없음 시 가이드 생략

### Task 도구 테스트
- [ ] Scenario RA-303-1: Task 도구 호출 시 서브에이전트 실패율 경고 출력하지 않음 (비활성화)

### 출력 형식 테스트
- [ ] Scenario RA-304-1: 여러 가이드 동시 존재 시 개행으로 결합
- [ ] Scenario RA-304-2: 가이드 항목 없을 때 stdout 없이 exit 0

### 비차단 실행 테스트
- [ ] Scenario RA-305-1: DB 접근 실패 시 exit 0

## 비기능 요구사항

### 성능
- [ ] 훅 실행 시간 2초 이내
- [ ] 벡터 검색 사용하지 않고 텍스트 매칭만 사용하여 동기 블로킹 훅의 지연 최소화

### 출력 형식
- [ ] stdout: `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "..." } }`
- [ ] additionalContext에 여러 가이드 항목을 개행(`\n`)으로 구분

## 제약사항 검증
- [ ] `better-sqlite3` 패키지 사용
- [ ] `db.mjs`의 함수 import
- [ ] `searchErrorKB()` 사용 금지 (error_kb 테이블 직접 쿼리)
- [ ] PreToolUse는 동기 블로킹 훅이므로 async 작업(임베딩 생성) 수행하지 않음

## matcher 필터링
- [ ] 훅 등록 matcher: `"Edit|Write|Bash|Task"`
- [ ] 이 4개 도구에 대해서만 훅 실행
- [ ] 다른 도구(Read, Grep 등)는 matcher로 필터링되어 훅 미호출
