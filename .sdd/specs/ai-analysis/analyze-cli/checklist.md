# 체크리스트: analyze-cli

## 스펙 완성도
- [x] 모든 REQ(AC-001~006)에 GIVEN-WHEN-THEN 시나리오 포함
- [x] RFC 2119 키워드 적절히 사용 (SHALL 중심, SHOULD 일부 성능 목표)
- [x] depends 필드 정확 (ai-analyzer, log-writer)

## DESIGN.md 일치
- [x] REQ-AC-001: CLI 인자 파싱 (--days 기본값 30, --project null, --project-path null, process.argv 직접 파싱) — DESIGN.md 5.3절 일치
- [x] REQ-AC-002: 분석 헤더 출력 (기간 표시) — DESIGN.md 5.3절 일치
- [x] REQ-AC-003: 데이터 부족 처리 (프롬프트 5개 미만 안내) — DESIGN.md 5.3절 일치
- [x] REQ-AC-004: 분석 결과 포맷팅 출력 (클러스터, 워크플로우, 에러 패턴, 제안 4개 섹션) — DESIGN.md 5.3절 일치
- [x] REQ-AC-005: 분석 실패 처리 (stderr 출력 + exit 1) — DESIGN.md 5.3절 일치
- [x] REQ-AC-006: 적용 안내 출력 (apply.mjs 명령어) — DESIGN.md 5.3절 일치

## 교차 참조
- [x] ai-analyzer.mjs runAnalysis로 분석 실행
- [x] suggestion-engine/apply-cli와 dismiss-cli 명령어 참조
- [x] db.mjs 데이터 접근은 runAnalysis 내부에서 수행

## 테스트 계획
- [x] 기본 인자로 실행 (days=30, project=null, projectPath=null)
- [x] 커스텀 인자로 실행 (--days 14 --project my-app)
- [x] project-path 인자 포함 실행 (--project-path /home/user/my-app)
- [x] 헤더 출력 (분석 기간 표시)
- [x] 프롬프트 부족 시 안내 메시지 + exit 0
- [x] 전체 결과 출력 (4개 섹션)
- [x] 일부 섹션만 존재 시 선택적 출력
- [x] AI 분석 에러 시 stderr 출력 + exit 1
- [x] 적용 안내 메시지 출력

## 구현 주의사항
- **외부 라이브러리 없음**: process.argv 직접 파싱, 인자 파싱 라이브러리 사용 금지
- **인자 파싱 패턴**: args.find((_, i, a) => a[i - 1] === '--days') || '30'
- **4개 섹션 구조**:
  1. 반복 프롬프트 클러스터: [count회] intent - summary, 예시 최대 3개
  2. 반복 도구 시퀀스: [count회] pattern (purpose)
  3. 반복 에러 패턴: [count회] pattern, proposedRule
  4. 개선 제안: 번호, [type] summary, 근거, 제안
- **적용 안내**: node ~/.self-generation/bin/apply.mjs <번호>
- **성능**: CLI 자체 오버헤드 100ms 이내 (인자 파싱 + 포맷팅)
- **runAnalysis 의존**: 전체 실행 시간은 runAnalysis() 소요 시간에 의존
