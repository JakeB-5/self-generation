# 체크리스트: subagent-context

## 스펙 완성도
- [ ] 모든 REQ에 GIVEN-WHEN-THEN 시나리오 포함
- [ ] RFC 2119 키워드 적절히 사용 (SHALL)
- [ ] depends 필드 정확: data-collection/log-writer, realtime-assist/error-kb, ai-analysis/ai-analyzer

## DESIGN.md 일치

### REQ-RA-401: 코드 에이전트 필터링
- [ ] CODE_AGENTS 목록: executor, executor-low, executor-high, architect, architect-medium, designer, designer-high, build-fixer, build-fixer-low
- [ ] stdin의 `agent_type` 필드를 CODE_AGENTS와 비교 (`includes` 사용)
- [ ] CODE_AGENTS 중 하나 포함하면 컨텍스트 주입, 아니면 즉시 exit 0
- [ ] 복합 타입명 (oh-my-claudecode:executor-high) 매칭 지원

### REQ-RA-402: 프로젝트별 최근 에러 패턴 주입 — 텍스트 직접 쿼리
- [ ] v9 설계: `searchErrorKB()` 사용하지 않음 (벡터 검색 회피)
- [ ] `queryEvents({ type: 'tool_error', projectPath: projectDir, limit: 3 })` 호출
- [ ] error_kb 테이블 직접 텍스트 쿼리: `SELECT resolution FROM error_kb WHERE error_normalized = ? AND resolution IS NOT NULL ORDER BY use_count DESC LIMIT 1`
- [ ] 에러 패턴 표시: `이 프로젝트의 최근 에러 패턴:`, `- ${err.error} (${err.tool})`, `해결: ${JSON.stringify(kb.resolution).slice(0, 150)}`
- [ ] 해결 방법 텍스트 150자 제한
- [ ] 에러 없으면 섹션 출력하지 않음

### REQ-RA-403: AI 분석 규칙 주입 — 프로젝트 필터
- [ ] `getCachedAnalysis(48, project)` 호출로 48시간 이내 프로젝트별 캐시 조회
- [ ] `suggestions` 중 `type === 'claude_md'`이고 프로젝트 일치하거나 전역인 항목 필터링: `!s.project || s.project === project`
- [ ] 최대 3건까지 선택하여 "적용할 프로젝트 규칙:" 섹션 주입
- [ ] 각 규칙의 `rule` 또는 `summary` 필드 사용

### REQ-RA-404: 컨텍스트 크기 제한
- [ ] 에러 패턴 + AI 규칙 전체 텍스트를 `\n`으로 결합 후 `.slice(0, 500)`으로 절단
- [ ] 컨텍스트 비어있으면 stdout 출력 없이 종료

### REQ-RA-405: 출력 형식
- [ ] JSON: `{ "hookSpecificOutput": { "hookEventName": "SubagentStart", "additionalContext": "..." } }`
- [ ] hookEventName은 `"SubagentStart"`이어야 함

### REQ-RA-406: 비차단 실행 보장
- [ ] 전체 로직을 try-catch로 감싸기
- [ ] 예외 발생 시 `process.exit(0)`으로 종료

### REQ-RA-407: isEnabled 체크
- [ ] `isEnabled()` 함수로 시스템 활성화 상태 확인
- [ ] 비활성화 시 컨텍스트 주입하지 않고 즉시 exit 0

## 교차 참조

### data-collection/log-writer 인터페이스
- [ ] `queryEvents()` 함수 사용
- [ ] `getDb()`, `getProjectName()`, `getProjectPath()`, `readStdin()`, `isEnabled()` 함수 사용

### realtime-assist/error-kb 인터페이스
- [ ] error_kb 테이블 스키마 (error_normalized, resolution) 일치
- [ ] `searchErrorKB()` 사용하지 않음 (벡터 검색 회피)

### ai-analysis/ai-analyzer 인터페이스
- [ ] `getCachedAnalysis(hours, project)` 함수 시그니처 일치 (project 파라미터 필수)

## 테스트 계획

### 코드 에이전트 필터링 테스트
- [ ] Scenario RA-401-1: 코드 에이전트 (`executor`) 시작 시 컨텍스트 주입
- [ ] Scenario RA-401-2: 비코드 에이전트 (`researcher`) 시작 시 즉시 exit 0
- [ ] Scenario RA-401-3: 복합 타입명 (`oh-my-claudecode:executor-high`) 매칭

### 에러 패턴 주입 테스트
- [ ] Scenario RA-402-1: 프로젝트 에러 이력 있을 때 에러 3건 + 해결 이력 주입
- [ ] Scenario RA-402-2: 프로젝트 에러 이력 없을 때 섹션 생략

### AI 분석 규칙 주입 테스트
- [ ] Scenario RA-403-1: AI 분석 규칙 있을 때 2건 주입
- [ ] Scenario RA-403-2: AI 분석 캐시 만료 시 섹션 생략
- [ ] Scenario RA-403-3: 전역 규칙 + 프로젝트 규칙 혼합 (3건 모두 주입)

### 컨텍스트 크기 제한 테스트
- [ ] Scenario RA-404-1: 500자 초과 시 절단
- [ ] Scenario RA-404-2: 주입할 컨텍스트 없을 때 stdout 없이 exit 0

### 출력 형식 테스트
- [ ] Scenario RA-405-1: hookEventName="SubagentStart", additionalContext 포함

### 비차단 실행 테스트
- [ ] Scenario RA-406-1: 의존 모듈 로드 실패 시 exit 0

### isEnabled 체크 테스트
- [ ] Scenario RA-407-1: 시스템 비활성화 시 즉시 exit 0

## 비기능 요구사항

### 성능
- [ ] 훅 실행 시간 2초 이내
- [ ] 벡터 검색 사용하지 않고 텍스트 매칭만 사용하여 SubagentStart 지연 최소화

## 제약사항 검증
- [ ] `better-sqlite3` 패키지 사용
- [ ] `searchErrorKB()` 사용 금지 (error_kb 테이블 직접 쿼리)
- [ ] `ai-analyzer.mjs`의 `getCachedAnalysis(hours, project)` import (project 파라미터 필수)
- [ ] CODE_AGENTS 목록은 모듈 상단에 상수로 정의
