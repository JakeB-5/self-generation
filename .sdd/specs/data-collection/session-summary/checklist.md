# 체크리스트: session-summary

## 스펙 완성도
- [x] 모든 REQ(401~407)에 GIVEN-WHEN-THEN 시나리오 포함
- [x] RFC 2119 키워드 적절히 사용 (SHALL 중심, SHOULD AI 분석/배치 임베딩/확률적 정리)
- [x] depends 필드 정확 (log-writer, ai-analyzer)

## DESIGN.md 일치
- [x] REQ-DC-401: 세션 요약 집계 (type: 'session_summary', promptCount, toolCounts, toolSequence, errorCount, uniqueErrors, lastPrompts, lastEditedFiles, reason) — DESIGN.md 5.4절 확장 버전 일치
- [x] REQ-DC-402: 세션 이벤트 SQL 집계 (queryEvents + JavaScript 필터링) — DESIGN.md 4.6절 일치
- [x] REQ-DC-403: AI 분석 트리거 조건 (프롬프트 3개 이상, reason != 'clear', runAnalysisAsync 호출) — DESIGN.md 5.4절 v7 P8 일치
- [x] REQ-DC-404: Non-blocking 실행 (집계/AI/배치 임베딩 실패도 exit 0) — Constitution 2.1절 일치
- [x] REQ-DC-405: 배치 임베딩 생성 트리거 (detached spawn, child.unref) — DESIGN.md 5.4절 일치
- [x] REQ-DC-406: 확률적 DB 정리 (10% 확률, pruneOldEvents 호출) — DESIGN.md 5.4절 v9 일치
- [x] REQ-DC-407: 시스템 활성화 체크 (isEnabled) — DESIGN.md 공통 패턴 일치

## 교차 참조
- [x] db.mjs insertEvent로 요약 기록
- [x] db.mjs queryEvents로 세션 이벤트 조회
- [x] db.mjs pruneOldEvents로 정리 수행
- [x] ai-analyzer.mjs runAnalysisAsync로 AI 분석 트리거
- [x] session-start-hook에서 session_summary 레코드 조회

## 테스트 계획
- [x] 정상 세션 요약 생성 (promptCount, toolCounts, toolSequence, errorCount, uniqueErrors)
- [x] 도구 사용 횟수 집계 (toolCounts 객체)
- [x] 도구 시퀀스 기록 (사용 순서대로 배열)
- [x] 고유 에러 수집 (중복 제거)
- [x] 마지막 프롬프트 3개 기록 (처음 100자)
- [x] 수정 파일 최대 5개 기록 (중복 제거)
- [x] 종료 사유 기록 (reason)
- [x] 빈 세션 (promptCount: 0, 빈 배열들)
- [x] 프롬프트 3개 이상 + reason != 'clear' 시 runAnalysisAsync 호출
- [x] 프롬프트 3개 미만 시 AI 분석 미실행
- [x] reason = 'clear' 시 AI 분석 미실행
- [x] detached 배치 임베딩 프로세스 생성 (spawn + unref)
- [x] 배치 임베딩 트리거 실패 무시
- [x] 확률적 pruning 트리거 (Math.random() < 0.1)
- [x] pruning 실패 무시
- [x] DB 조회 실패 시 exit 0
- [x] isEnabled false 시 즉시 exit 0

## 구현 주의사항
- **5.4절 확장 버전 구현**: DESIGN.md 4.6절(Phase 1)이 아닌 5.4절(확장 버전) 구현 — Phase 1 기본 버전 구현하지 말 것
- **runAnalysisAsync는 ai-analyzer에서 import**: import { runAnalysisAsync } from '../lib/ai-analyzer.mjs'
- **pruneOldEvents는 db.mjs에서 import**: import { pruneOldEvents } from '../lib/db.mjs' — 10% 확률로 호출
- **toolSequence 용도**: 워크플로우 패턴 분석 (예: Read→Edit→Bash 반복)
- **배치 임베딩 스크립트**: ~/.self-generation/lib/batch-embeddings.mjs
- **배치 임베딩 딜레이**: 10초 딜레이 후 실행하여 DB 쓰기 경합 감소 (WAL + busy_timeout으로 최종 보장)
- **JSONL 제거**: 저장소는 SQLite events 테이블, insertEvent()/queryEvents() 사용
