# 체크리스트: subagent-tracker

## 스펙 완성도
- [ ] 모든 REQ에 GIVEN-WHEN-THEN 시나리오 포함
- [ ] RFC 2119 키워드 적절히 사용 (SHALL/SHALL NOT)
- [ ] depends 필드 정확: data-collection/log-writer

## DESIGN.md 일치

### REQ-RA-201: SubagentStop 이벤트 기록
- [ ] 기록 필드: type ("subagent_stop"), ts, sessionId, project, projectPath, agentId, agentType
- [ ] `db.mjs`의 `insertEvent()` 함수 사용
- [ ] v9 주의: `success` 필드는 기록하지 않음 (SubagentStop API가 성공/실패 정보 미제공)
- [ ] stdin 필드 일부 누락 시 가능한 필드만으로 기록하고 정상 종료 (exit 0)

### REQ-RA-202: 서브에이전트 사용 통계 — SQL 집계
- [ ] 별도 통계 파일 없이 `events` 테이블 SQL 집계로 제공
- [ ] SQL: `SELECT json_extract(data, '$.agentType') AS agent_type, COUNT(*) AS total FROM events WHERE type = 'subagent_stop' GROUP BY agent_type`
- [ ] `subagent-stats.jsonl` 파일 사용 금지
- [ ] 성공/실패율 통계는 현재 제공하지 않음 (SubagentStop API 한계)

### REQ-RA-203: 비차단 실행 보장
- [ ] 전체 로직을 try-catch로 감싸기
- [ ] 예외 발생 시 조용히 `process.exit(0)`으로 종료
- [ ] stdin 파싱 실패, DB 쓰기 실패 등 모든 에러 흡수
- [ ] stdout 출력 없음 (이 훅은 컨텍스트 주입하지 않고 데이터 수집만)

### REQ-RA-204: isEnabled 체크
- [ ] `isEnabled()` 함수로 시스템 활성화 상태 확인
- [ ] 비활성화 시 이벤트 기록하지 않고 즉시 exit 0

## 교차 참조

### data-collection/log-writer 인터페이스
- [ ] `insertEvent(eventData)` 함수 시그니처 일치
- [ ] `readStdin()`, `isEnabled()`, `getProjectName()`, `getProjectPath()` 함수 사용

### hooks 통합
- [ ] ai-analyzer.mjs: SQL 집계 쿼리로 서브에이전트 통계 조회

## 테스트 계획

### SubagentStop 이벤트 기록 테스트
- [ ] Scenario RA-201-1: 정상적인 SubagentStop 이벤트 기록 (success 필드 없음)
- [ ] Scenario RA-201-2: stdin 필드 일부 누락 시 가능한 필드만 기록

### SQL 집계 쿼리 테스트
- [ ] Scenario RA-202-1: 에이전트 타입별 사용 횟수 조회 (`executor`: 10건, `architect`: 5건)
- [ ] Scenario RA-202-2: 데이터 없을 때 빈 결과 반환

### 비차단 실행 테스트
- [ ] Scenario RA-203-1: stdin 파싱 실패 시 exit 0
- [ ] Scenario RA-203-2: DB 쓰기 실패 시 exit 0

### isEnabled 체크 테스트
- [ ] Scenario RA-204-1: 시스템 비활성화 시 즉시 exit 0

## 비기능 요구사항

### 성능
- [ ] 훅 실행 시간 2초 이내 (Claude Code 훅 타임아웃 준수)
- [ ] SQLite 동기 쓰기로 프로세스 종료 전 기록 완료 보장

### 데이터 무결성
- [ ] `events` 테이블 스키마 준수
- [ ] `data` 컬럼은 유효한 JSON 문자열

## 제약사항 검증
- [ ] `better-sqlite3` 패키지 사용
- [ ] `db.mjs` 모듈의 함수 활용
- [ ] stdout 출력 없음 (데이터 수집만)

## v9 회귀 방지
- [ ] success 필드 제거 확인: `data` JSON에 `success` 필드 포함하지 않음
- [ ] 향후 SubagentStop API에 실패 정보 추가되면 `agent_transcript_path` 파싱으로 정확한 성공/실패 판정 구현 가능
