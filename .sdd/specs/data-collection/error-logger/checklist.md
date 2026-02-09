# 체크리스트: error-logger

## 스펙 완성도
- [x] 모든 REQ(301~305)에 GIVEN-WHEN-THEN 시나리오 포함
- [x] RFC 2119 키워드 적절히 사용 (SHALL 중심, SHOULD resolution JSON 파싱)
- [x] depends 필드 정확 (log-writer, error-kb)

## DESIGN.md 일치
- [x] REQ-DC-301: 에러 수집 (type: 'tool_error', tool, error, errorRaw) — DESIGN.md 8.1절 v6 확장 버전 일치
- [x] REQ-DC-302: 에러 정규화 (error-kb.mjs normalizeError 사용, 단일 소유자 원칙) — DESIGN.md 8.1절 일치
- [x] REQ-DC-303: 에러 KB 실시간 검색 (searchErrorKB, 2초 타임아웃, additionalContext 주입) — DESIGN.md 8.1절 v9 타임아웃 일치
- [x] REQ-DC-304: Non-blocking 실행 (KB 검색 실패도 exit 0) — Constitution 2.1절 일치
- [x] REQ-DC-305: 시스템 활성화 체크 (isEnabled) — DESIGN.md 공통 패턴 일치

## 교차 참조
- [x] db.mjs insertEvent로 이벤트 기록
- [x] error-kb.mjs normalizeError, searchErrorKB 함수 사용
- [x] realtime-assist/error-kb 스펙 REQ-RA-001 정규화 규칙 참조
- [x] session-summary에서 errorCount, uniqueErrors 집계

## 테스트 계획
- [x] 도구 실행 실패 기록 (tool_error 이벤트)
- [x] normalizeError 사용 (error-kb.mjs에서 import)
- [x] errorRaw 원본 500자 저장
- [x] searchErrorKB 과거 해결 이력 발견 시 additionalContext 출력
- [x] resolution JSON 파싱 (resolvedBy, toolSequence 추출)
- [x] searchErrorKB 2초 타임아웃 (Promise.race)
- [x] 해결 이력 미발견 시 무출력
- [x] KB 검색 중 오류 내부 try-catch
- [x] stdin 파싱 실패 시 exit 0
- [x] isEnabled false 시 즉시 exit 0

## 구현 주의사항
- **v6 확장 버전 구현**: DESIGN.md 4.5절(Phase 1)이 아닌 8.1절 하단(v6 확장) 구현 — Phase 1과 v6 병합하지 말 것
- **normalizeError는 error-kb에서 import**: import { normalizeError, searchErrorKB } from '../lib/error-kb.mjs' — 단일 소유자 원칙
- **3단계 검색**: (1) 정확한 텍스트 매칭 ~1ms, (2) 접두사 매칭 + 길이비율 70% ~2ms, (3) 벡터 유사도 distance < 0.76 ~5ms
- **errorRaw 용도**: 원본 에러의 처음 500자를 저장하여 디버깅 시 참고
- **정규화 순서**: 경로 → 숫자 → 문자열 (경로 내 숫자가 먼저 <N>으로 치환되는 것 방지)
- **additionalContext 형식**: hookEventName: 'PostToolUseFailure', 에러 KB 해결 이력 메시지
- **JSONL 제거**: 저장소는 SQLite events 테이블, insertEvent() 사용
