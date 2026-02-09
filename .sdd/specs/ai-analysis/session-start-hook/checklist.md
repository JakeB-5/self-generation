# 체크리스트: session-start-hook

## 스펙 완성도
- [x] 모든 REQ(SSH-001~008)에 GIVEN-WHEN-THEN 시나리오 포함
- [x] RFC 2119 키워드 적절히 사용 (SHALL 중심, SHOULD 이전 세션/임베딩 데몬)
- [x] depends 필드 정확 (ai-analyzer, log-writer, embedding-daemon)

## DESIGN.md 일치
- [x] REQ-SSH-001: 시스템 활성화 확인 (isEnabled) — DESIGN.md 공통 패턴 일치
- [x] REQ-SSH-002: 캐시된 분석 결과 주입 (getCachedAnalysis(24, project), 최대 3개) — DESIGN.md 6.1절 일치
- [x] REQ-SSH-003: 제안 메시지 포맷팅 ([type] summary [id: suggest-N], apply/dismiss 안내) — DESIGN.md 6.1절 일치
- [x] REQ-SSH-004: 이전 세션 컨텍스트 주입 (session_summary 레코드, promptCount/toolCounts/lastPrompts/lastEditedFiles/errorCount/uniqueErrors/주요 도구) — DESIGN.md 6.1절 v7 P2 일치
- [x] REQ-SSH-005: 세션 재개 감지 (source: 'resume', [RESUME] 태그) — DESIGN.md 6.1절 v7 P8 일치
- [x] REQ-SSH-006: 임베딩 데몬 자동 시작 (isServerRunning, startServer, dynamic import) — DESIGN.md 6.1절 일치
- [x] REQ-SSH-007: stdout 출력 및 종료 (hookSpecificOutput.additionalContext, contextParts 빈 경우 무출력) — DESIGN.md 6.1절 일치
- [x] REQ-SSH-008: 훅 실패 안전성 (최상위 try-catch, exit 0) — Constitution 2.1절 일치

## 교차 참조
- [x] db.mjs queryEvents로 session_summary 조회
- [x] db.mjs getProjectName, getProjectPath로 프로젝트 추출
- [x] ai-analyzer.mjs getCachedAnalysis로 캐시 조회
- [x] embedding-client.mjs isServerRunning, startServer로 데몬 관리
- [x] session-summary에서 session_summary 레코드 생성

## 테스트 계획
- [x] isEnabled false 시 즉시 exit 0
- [x] isEnabled true 시 계속 실행
- [x] 유효한 캐시에서 제안 주입 (최대 3개)
- [x] 캐시 없음 시 제안 미주입
- [x] 캐시 만료 시 제안 미주입
- [x] 제안 포맷팅 ([type] summary [id: suggest-N], apply/dismiss 안내)
- [x] 이전 세션 요약 주입 (promptCount, toolCounts, lastPrompts, lastEditedFiles, errorCount, uniqueErrors, 주요 도구 상위 3개)
- [x] 이전 세션 요약 없음 시 제안만 주입
- [x] 재개 세션 미해결 에러 상세 주입 ([RESUME] 태그)
- [x] 일반 세션 시작 (비재개, [RESUME] 태그 없음)
- [x] 임베딩 데몬 미실행 시 자동 시작
- [x] 임베딩 데몬 이미 실행 중 시 startServer 미호출
- [x] 임베딩 데몬 시작 실패 무시
- [x] contextParts 존재 시 JSON 출력 (hookEventName: 'SessionStart', additionalContext)
- [x] contextParts 빈 경우 무출력 + exit 0
- [x] DB 손상 또는 접근 실패 시 exit 0
- [x] 모듈 로드 실패 시 exit 0

## 구현 주의사항
- **100ms 성능 제약**: DB 조회만 수행, AI 호출 금지, 읽기 전용 작업
- **프로젝트별 캐시**: getCachedAnalysis(24, project) — project는 cwd에서 getProjectPath → getProjectName으로 추출
- **임베딩 데몬 dynamic import**: await import('../lib/embedding-client.mjs')로 로드, 실패 시 무시
- **contextParts 배열**: 제안 + 이전 세션 컨텍스트를 '\n\n'으로 연결
- **[RESUME] 태그**: source: 'resume'인 경우에만 미해결 에러에 태그 추가
- **주요 도구 상위 3개**: toolCounts 객체를 정렬하여 상위 3개 추출
- **stdout 형식**: { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }
- **최상위 try-catch**: 모든 코드 경로에서 exit 0 보장
