# 체크리스트: error-kb

## 스펙 완성도
- [ ] 모든 REQ에 GIVEN-WHEN-THEN 시나리오 포함
- [ ] RFC 2119 키워드 적절히 사용 (SHALL/SHOULD/MAY)
- [ ] depends 필드 정확: data-collection/log-writer

## DESIGN.md 일치

### REQ-RA-001: 에러 메시지 정규화 (normalizeError)
- [ ] 파일 경로 (`/로 시작`) → `<PATH>` 치환
- [ ] 2자리 이상 숫자 → `<N>` 치환
- [ ] 작은따옴표/큰따옴표 감싼 문자열 (100자 이내) → `<STR>` 치환
- [ ] 결과를 최대 200자로 절단 및 양끝 공백 제거
- [ ] DESIGN.md 9.2.1절 정규화 규칙과 정확히 일치

### REQ-RA-002: 에러 KB 검색 (searchErrorKB) — Strong-signal shortcut
- [ ] **1단계**: 정확 텍스트 매치 (`error_normalized = ?`, use_count DESC, ts DESC) — ~1ms
- [ ] **2단계**: 접두사 텍스트 매치 (앞 30자 LIKE, 길이 비율 70% 이상) — 비율 미달 시 3단계로
- [ ] **3단계**: 벡터 유사도 검색 (cosine distance < 0.76, 상위 3건, ~5ms)
- [ ] `generateEmbeddings([normalizedError])` 호출하여 쿼리 임베딩 생성
- [ ] `vectorSearch('error_kb', 'vec_error_kb', embedding, 3)` 호출
- [ ] `resolution IS NOT NULL` 필터링
- [ ] 매치 발견 시 `use_count` 1 증가, `last_used` 현재 시각 갱신
- [ ] DB 없거나 테이블 비어있으면 `null` 반환
- [ ] 벡터 검색 실패 시 예외 흡수하고 `null` 반환
- [ ] DESIGN.md 9.2.2절 Strong-signal 패턴과 정확히 일치

### REQ-RA-003: 에러 해결 기록 (recordResolution) — UPSERT 패턴
- [ ] UPSERT SQL: `INSERT INTO error_kb (...) VALUES (...) ON CONFLICT(error_normalized) DO UPDATE SET ...`
- [ ] 기록 필드: ts, error_normalized, error_raw, resolution, resolved_by, tool_sequence, use_count (초기값 1)
- [ ] ON CONFLICT 시 ts, resolution, resolved_by, tool_sequence 갱신, use_count 증가
- [ ] 임베딩은 기록 시점에 생성하지 않음 (SessionEnd 배치로 연기)
- [ ] DB 없을 때 자동 생성
- [ ] DESIGN.md 9.2.3절 UPSERT 로직과 정확히 일치

### REQ-RA-004: error_kb 테이블 스키마 준수
- [ ] 필수 컬럼: ts (TEXT NOT NULL), error_normalized (TEXT NOT NULL UNIQUE)
- [ ] 선택 컬럼: error_raw (TEXT), resolution (TEXT), resolved_by (TEXT), tool_sequence (TEXT), use_count (INTEGER DEFAULT 0), last_used (TEXT)
- [ ] UNIQUE 인덱스: `idx_error_kb_normalized`
- [ ] 임베딩은 `vec_error_kb` 가상 테이블에 별도 저장 (error_kb_id INTEGER PRIMARY KEY, embedding float[384])
- [ ] DESIGN.md 9.1절 스키마와 정확히 일치

### REQ-RA-005: 배치 임베딩 생성 (generateErrorEmbeddings)
- [ ] SessionEnd 시점에 임베딩 없는 엔트리 조회: `SELECT id, error_normalized FROM error_kb WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)`
- [ ] `generateEmbeddings(texts)` 함수로 벡터 생성 (Transformers.js 기반)
- [ ] `vec_error_kb`에 삽입: `DELETE FROM vec_error_kb WHERE error_kb_id = ?; INSERT INTO vec_error_kb (error_kb_id, embedding) VALUES (?, ?);`
- [ ] 임베딩 생성 실패 시 해당 엔트리 건너뛰고 다음 계속 처리
- [ ] 최대 50건씩 배치 처리 (SHOULD)
- [ ] DESIGN.md 9.2.4절 배치 전략과 정확히 일치

## 교차 참조

### data-collection/log-writer 인터페이스
- [ ] `getDb()` 함수로 DB 접근
- [ ] `generateEmbeddings(texts)` 함수 사용 (async, 384차원 float 배열 반환)
- [ ] `vectorSearch(tableName, vecTableName, embedding, limit)` 함수 사용

### realtime-assist/embedding-daemon 연동
- [ ] `generateEmbeddings()` 내부에서 embedding-client.mjs의 `embedViaServer()` 호출
- [ ] Unix socket 통신으로 Transformers.js 모델에서 벡터 생성

### normalizeError() Single Owner
- [ ] error-kb.mjs가 normalizeError() 함수의 단일 소유자
- [ ] 다른 모듈(error-logger, tool-logger, pre-tool-guide, subagent-context)은 이 모듈에서 import

### hooks 통합
- [ ] error-logger.mjs: PostToolUseFailure 시 `searchErrorKB()` 호출하여 해결 이력 조회
- [ ] tool-logger.mjs: 에러 해결 감지 시 `recordResolution()` 호출
- [ ] pre-tool-guide.mjs: PreToolUse 시 error_kb 테이블 직접 텍스트 쿼리 (벡터 검색 회피, 성능 우선)
- [ ] subagent-context.mjs: SubagentStart 시 error_kb 테이블 직접 텍스트 쿼리 (벡터 검색 회피)
- [ ] batch-embeddings.mjs: SessionEnd 후 detached 프로세스로 `generateErrorEmbeddings()` 실행

## 테스트 계획

### 에러 정규화 테스트
- [ ] Scenario RA-001-1: 파일 경로 포함 에러 정규화 (`/Users/dev/project/src/index.ts` → `<PATH>`)
- [ ] Scenario RA-001-2: 숫자와 경로 혼합 에러 정규화 (`line 42 in /src/app.js` → `line <N> in <PATH>`)
- [ ] Scenario RA-001-3: 200자 초과 에러 메시지 절단 및 양끝 공백 제거

### 에러 KB 검색 테스트 (Strong-signal)
- [ ] Scenario RA-002-1: 정확 텍스트 매치로 ~1ms 내 해결 이력 조회
- [ ] Scenario RA-002-2: 접두사 매치 성공 (길이 비율 70% 이상)
- [ ] Scenario RA-002-3: 접두사 매치 길이 비율 미달 → 벡터 폴백
- [ ] Scenario RA-002-4: 텍스트 매치 실패 후 벡터 검색 fallback (distance < 0.76, ~5ms)
- [ ] Scenario RA-002-5: DB 부재 시 `null` 반환
- [ ] 매치 발견 시 use_count 증가 및 last_used 갱신 검증

### 에러 해결 기록 테스트
- [ ] Scenario RA-003-1: 새 에러 정상 기록 (UPSERT INSERT, use_count: 1)
- [ ] Scenario RA-003-2: 기존 에러 재해결 시 UPSERT UPDATE (use_count 증가)
- [ ] Scenario RA-003-3: DB 없을 때 자동 생성
- [ ] 임베딩 기록하지 않음 검증 (SessionEnd 배치로 연기)

### 배치 임베딩 생성 테스트
- [ ] Scenario RA-005-1: 미임베딩 엔트리 5건에 벡터 임베딩 배치 생성
- [ ] Scenario RA-005-2: 부분 임베딩 생성 실패 시 실패 엔트리 건너뛰고 나머지 처리
- [ ] Scenario RA-005-3: 임베딩 없는 엔트리가 없을 때 즉시 반환
- [ ] float[384] 벡터가 vec_error_kb에 Buffer 형태로 저장되는지 검증

### 스키마 검증 테스트
- [ ] Scenario RA-004-1: error_normalized NULL 시 NOT NULL 제약으로 INSERT 실패
- [ ] UNIQUE 제약: 동일 error_normalized INSERT 시 ON CONFLICT 발동
- [ ] vec_error_kb 가상 테이블 구조: error_kb_id, embedding float[384]

## 비기능 요구사항

### 성능
- [ ] `searchErrorKB()` 호출 50ms 이내 (SHOULD)
- [ ] 정확 텍스트 매치 ~1ms (Strong-signal 1단계)
- [ ] 벡터 검색 ~5ms (fallback 3단계)
- [ ] sqlite-vec 인덱스 활용하여 10,000건 이상에서도 성능 저하 없음 (SHOULD)
- [ ] 임베딩 배치 생성은 SessionEnd 시점에만 수행 (실시간 훅 2초 타임아웃에 영향 없음)

### 안정성
- [ ] 모든 함수는 예외 발생 시 `null` 또는 빈 값 반환 (프로세스 중단 금지)
- [ ] DB 접근 실패 시 graceful하게 `null` 반환
- [ ] 벡터 검색 실패 시 예외 흡수

## 제약사항 검증
- [ ] `better-sqlite3` 패키지 사용
- [ ] `sqlite-vec` 확장 로드
- [ ] `normalizeError()`는 error-kb 모듈이 단일 소유자 (Single Owner)
- [ ] DB 경로: `~/.self-generation/data/self-gen.db`
- [ ] 임베딩 차원: 384 (float 배열)
- [ ] 임베딩 생성에 `db.mjs`의 `generateEmbeddings()` 사용 (Transformers.js 기반, async)

## 벡터 검색 도입 배경
- [ ] 기존 JSONL 텍스트 매칭의 한계 문서화: "Cannot find module 'react'" vs "Module not found: Error: Can't resolve 'react'" 같은 의미적 유사 에러 매칭 실패
- [ ] sqlite-vec 벡터 유사도 검색으로 cosine distance 기반 의미적 유사성 처리
- [ ] 임계값 0.76 선정 근거 및 적절성

## 임베딩 전략
- [ ] 생성 시점: 실시간 훅(2초 제한) 중 임베딩 생성 금지, SessionEnd 배치에서 생성
- [ ] Fallback: 임베딩 없는 엔트리는 텍스트 매칭(정확 + 접두사)으로 검색 가능
- [ ] 차원: 384 (Transformers.js `paraphrase-multilingual-MiniLM-L12-v2` 모델)
- [ ] 임계값: cosine distance 0.76 미만을 유사 매치로 판정
