# 체크리스트: ai-analyzer

## 스펙 완성도
- [x] 모든 REQ(AA-001~007)에 GIVEN-WHEN-THEN 시나리오 포함
- [x] RFC 2119 키워드 적절히 사용 (SHALL 중심, SHOULD 일부 성능 목표)
- [x] depends 필드 정확 (log-writer, feedback-tracker, skill-matcher)

## DESIGN.md 일치
- [x] REQ-AA-001: Content-Addressable 입력 해시 (SHA-256, type+ts+session_id+data) — DESIGN.md 5.2절 computeInputHash 일치
- [x] REQ-AA-002: 동기 AI 분석 실행 (claude --print --model sonnet, 캐시 히트 확인, UPSERT, 프롬프트 5개 미만 스킵) — DESIGN.md 5.1절 runAnalysis 일치
- [x] REQ-AA-003: 비동기 AI 분석 실행 (spawn detached + unref) — DESIGN.md 5.1절 runAnalysisAsync 일치
- [x] REQ-AA-004: 프롬프트 빌드 (analyze.md 템플릿, 로그/피드백/스킬/메트릭 주입, loadSkills 인자 없이 호출) — DESIGN.md 5.1절 buildPrompt 일치
- [x] REQ-AA-005: JSON 응답 추출 (코드 블록 + 순수 JSON 지원) — DESIGN.md 5.2절 extractJSON 일치
- [x] REQ-AA-006: 분석 캐시 조회 (TTL 24시간, 프로젝트 필터, null 폴백) — DESIGN.md 5.2절 getCachedAnalysis 일치
- [x] REQ-AA-007: 로그 요약 (프롬프트 최근 100개, 세션별 도구 시퀀스 집계) — DESIGN.md 5.2절 summarizeForPrompt 일치

## 교차 참조
- [x] db.mjs queryEvents로 이벤트 조회
- [x] db.mjs getDb로 analysis_cache 테이블 접근
- [x] feedback-tracker.mjs getFeedbackSummary로 피드백 이력 조회
- [x] skill-matcher.mjs loadSkills로 전역 스킬 조회 (인자 없이 호출)
- [x] session-summary에서 runAnalysisAsync 호출
- [x] session-start-hook에서 getCachedAnalysis 호출
- [x] analyze-cli에서 runAnalysis 호출

## 테스트 계획
- [x] computeInputHash 동일 이벤트 일관성
- [x] computeInputHash 이벤트 변경 시 해시 변경
- [x] runAnalysis 충분한 데이터로 분석 실행 (claude --print)
- [x] runAnalysis Content-Addressable 캐시 히트
- [x] runAnalysis 데이터 부족 시 분석 생략 (프롬프트 5개 미만)
- [x] runAnalysis claude --print 실행 실패 시 빈 결과 + 에러 메시지 반환
- [x] runAnalysis 캐시 저장 시 UPSERT (INSERT ON CONFLICT DO UPDATE)
- [x] runAnalysisAsync detached 프로세스 생성 (spawn + unref)
- [x] buildPrompt 모든 데이터 존재 시 플레이스홀더 치환
- [x] buildPrompt 피드백 이력 없는 첫 분석
- [x] extractJSON 코드 블록 내 JSON 추출
- [x] extractJSON 순수 JSON 응답 추출
- [x] getCachedAnalysis 유효한 캐시 조회 (프로젝트 필터)
- [x] getCachedAnalysis 다른 프로젝트 캐시 미반환
- [x] getCachedAnalysis 캐시 만료 시 null 반환
- [x] getCachedAnalysis DB 오류 시 null 반환
- [x] summarizeForPrompt 대량 로그 요약 (프롬프트 최근 100개)
- [x] summarizeForPrompt 반환 객체 구조 (prompts, toolSequences, errors, sessionSummaries)

## 구현 주의사항
- **computeInputHash 컨텐츠 수준**: type+ts+session_id+data로 SHA-256, 동일 이벤트 → 동일 해시
- **UPSERT 패턴**: INSERT ON CONFLICT(project, days, input_hash) DO UPDATE SET ts, analysis
- **claude --print 옵션**: input, encoding: 'utf-8', maxBuffer: 10MB, timeout: 120000ms
- **loadSkills 인자 없이**: buildPrompt 내에서 loadSkills() 호출 → 전역 스킬만 로드
- **getCachedAnalysis project null**: project=null이면 'all' 키로 조회 (프로젝트별 캐시 오염 방지)
- **summarizeForPrompt 세션별 집계**: 도구 사용을 세션별로 '도구→도구' 시퀀스 문자열로 요약
- **AI 분석 스키마**: clusters, workflows, errorPatterns, suggestions, skill_descriptions
- **안정성 보장**: AI 분석 실패 시 빈 결과 반환, 예외 전파 금지
