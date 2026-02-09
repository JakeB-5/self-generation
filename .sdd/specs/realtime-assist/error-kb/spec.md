---
id: error-kb
title: "에러 지식 베이스 (Error Knowledge Base)"
status: draft
created: 2026-02-07
domain: realtime-assist
depends: data-collection/log-writer
constitution_version: "2.0.0"
---

# error-kb

> `lib/error-kb.mjs` — 에러 해결 이력 검색, 해결 기록, 에러 메시지 정규화를 담당하는 유틸리티 모듈. normalizeError()의 단일 소유자(Single Owner)이다.

---

## 개요

에러 KB는 과거 발생한 에러와 그 해결 방법을 `error_kb` 테이블에 축적하고, 동일/유사 에러 재발 시 즉시 해결 이력을 제공한다. 벡터 유사도 검색(sqlite-vec)을 통해 의미적으로 유사한 에러를 매칭하며, 벡터가 없는 엔트리에 대해서는 텍스트 기반 fallback 매칭을 수행한다. 에러 메시지를 정규화하여 경로, 숫자, 문자열 리터럴 등 가변 부분을 제거함으로써 텍스트 fallback 매칭의 정확도를 높인다.

### 파일 위치

- 모듈: `~/.self-generation/lib/error-kb.mjs`
- 데이터: `~/.self-generation/data/self-gen.db` (`error_kb` 테이블)

### error_kb 테이블 스키마

```sql
CREATE TABLE error_kb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                -- ISO 8601 timestamp
  error_normalized TEXT NOT NULL UNIQUE,  -- normalizeError() result, UNIQUE for UPSERT
  error_raw TEXT,                  -- original error message
  resolution TEXT,                 -- resolution description
  resolved_by TEXT,                -- tool name used to resolve
  tool_sequence TEXT,              -- JSON array of tool names
  use_count INTEGER DEFAULT 0,    -- KB lookup count
  last_used TEXT                   -- last lookup timestamp
);

-- UNIQUE index on error_normalized (supports UPSERT ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_kb_error ON error_kb(error_normalized);

-- Vector search virtual table (sqlite-vec)
CREATE VIRTUAL TABLE vec_error_kb USING vec0(
  error_kb_id INTEGER PRIMARY KEY,  -- references error_kb.id
  embedding float[384]
);
```

---

## 요구사항

### REQ-RA-001: 에러 메시지 정규화 (normalizeError)

시스템은 에러 메시지에서 가변 요소를 치환하여 정규화된 문자열을 반환해야 한다(SHALL).

정규화 규칙:
1. 파일 경로 (`/로 시작하는 경로 패턴`) → `<PATH>` 치환 (SHALL)
2. 2자리 이상 숫자 → `<N>` 치환 (SHALL)
3. 작은따옴표/큰따옴표 감싼 문자열 (100자 이내) → `<STR>` 치환 (SHALL)
4. 결과를 최대 200자로 절단(SHALL)하고 양끝 공백을 제거(SHALL)

#### Scenario RA-001-1: 파일 경로가 포함된 에러 정규화

- **GIVEN** 에러 메시지 `"Cannot find module '/Users/dev/project/src/index.ts'"`
- **WHEN** `normalizeError(msg)`를 호출하면
- **THEN** 경로가 `<PATH>`로, 따옴표 문자열이 `<STR>`로 치환된 정규화 문자열을 반환한다

#### Scenario RA-001-2: 숫자와 경로가 혼합된 에러 정규화

- **GIVEN** 에러 메시지 `"Error at line 42 in /src/app.js: unexpected token"`
- **WHEN** `normalizeError(msg)`를 호출하면
- **THEN** `42`는 `<N>`으로, `/src/app.js`는 `<PATH>`로 치환된다

#### Scenario RA-001-3: 200자 초과 에러 메시지 절단

- **GIVEN** 300자 길이의 에러 메시지
- **WHEN** `normalizeError(msg)`를 호출하면
- **THEN** 정규화 후 최대 200자로 절단되고 양끝 공백이 제거된다

---

### REQ-RA-002: 에러 KB 검색 (searchErrorKB) — Strong-signal shortcut

시스템은 에러 메시지로 KB를 검색하여 과거 해결 이력을 반환해야 한다(SHALL).

QMD의 Strong-signal shortcut 패턴을 차용한 3단계 검색 전략 (우선순위 순서):
텍스트 매칭을 먼저 시도하고, 정확한 매칭이 없을 때만 벡터 검색으로 폴백한다.
이유: 정확 매칭은 ~1ms, 벡터 검색은 ~5ms — 정확 매칭 성공 시 80% 시간 절약.

1. **정확 텍스트 매치 (Strong-signal 1)**: 정규화된 에러와 `error_normalized` 필드가 완전히 일치하는 항목을 검색한다 (SHALL). `use_count DESC, ts DESC`로 정렬하여 가장 많이 사용된 최신 이력을 우선한다.
   ```sql
   SELECT * FROM error_kb
   WHERE error_normalized = ? AND resolution IS NOT NULL
   ORDER BY use_count DESC, ts DESC LIMIT 1
   ```
2. **접두사 텍스트 매치 (Strong-signal 2)**: 정확 매치 실패 시, 정규화된 에러의 앞 30자로 `LIKE` 검색을 수행한다 (SHALL). 길이 비율(length ratio)이 70% 이상일 때만 유효한 매치로 판정한다(SHALL).
   ```sql
   SELECT * FROM error_kb
   WHERE error_normalized LIKE ? AND resolution IS NOT NULL
   ORDER BY use_count DESC, ts DESC LIMIT 1
   ```
   (`?`에는 `normalizedError.slice(0, 30) + '%'` 바인딩)
   - 길이 비율 검증: `min(queryLen, resultLen) / max(queryLen, resultLen) >= 0.7` (SHALL)
   - 길이 비율 미달 시 벡터 검색으로 폴스루 (SHALL)
3. **벡터 유사도 검색 (fallback)**: 텍스트 매칭 실패 시에만 실행 (~5ms via daemon) (SHALL). `generateEmbeddings()`로 쿼리 임베딩을 생성하고, `vec_error_kb` 가상 테이블에서 상위 3건을 검색한다. `resolution`이 있는 항목만 필터링한다.
   ```javascript
   const embeddings = await generateEmbeddings([normalizedError]);
   const vectorResults = vectorSearch('error_kb', 'vec_error_kb', embeddings[0], 3)
     .filter(r => r.resolution != null);
   ```
   - **고신뢰 매칭** (distance < 0.76): 즉시 해당 엔트리를 반환한다(SHALL)
   - **저신뢰 매칭** (0.76 ≤ distance < 0.85): 키워드 검증을 추가로 수행해야 한다(SHALL). 쿼리와 매치 결과의 error_normalized에서 주요 키워드(3자 이상 단어)를 추출하고, 최소 1개 이상 공통 키워드가 있을 때만 유효한 매치로 판정한다
   - **매칭 없음** (distance ≥ 0.85): `null`을 반환한다(SHALL)

검색 결과 처리:
- 매치가 발견되면 해당 엔트리의 `use_count`를 1 증가시키고 `last_used`를 현재 시각으로 갱신해야 한다(SHALL).
  ```sql
  UPDATE error_kb SET use_count = use_count + 1, last_used = ? WHERE id = ?
  ```
- DB가 없거나 `error_kb` 테이블이 비어있으면 `null`을 반환해야 한다(SHALL).
- 해결 이력(`resolution`)이 있는 엔트리만 반환해야 한다(SHALL).
- 벡터 검색 실패(임베딩 데몬 미실행 등) 시 예외를 흡수하고 `null`을 반환해야 한다(SHALL).

#### Scenario RA-002-1: 정확 텍스트 매치로 해결 이력 조회 (Strong-signal)

- **GIVEN** `error_kb` 테이블에 `{ error_normalized: "Cannot find module <STR>", resolution: "npm install 실행" }` 엔트리가 존재
- **WHEN** `searchErrorKB("Cannot find module <STR>")`를 호출하면
- **THEN** 정확 텍스트 매치(~1ms)로 해당 엔트리를 반환하고, `use_count`가 1 증가하며 `last_used`가 갱신된다

#### Scenario RA-002-2: 접두사 매치 성공 (길이 비율 70% 이상)

- **GIVEN** `error_kb`에 정확 매치는 없지만, `error_normalized` 앞 30자가 검색어와 일치하고 길이 비율이 0.8인 엔트리가 존재
- **WHEN** `searchErrorKB(normalizedError)`를 호출하면
- **THEN** 접두사 텍스트 매치로 해당 엔트리를 반환한다

#### Scenario RA-002-3: 접두사 매치 길이 비율 미달 → 벡터 폴백

- **GIVEN** 접두사 매치 결과의 길이 비율이 0.5 (70% 미달)이고, 벡터 검색으로 cosine distance 0.15인 유사 엔트리가 존재
- **WHEN** `searchErrorKB(normalizedError)`를 호출하면
- **THEN** 접두사 매치를 무시하고, 벡터 유사도 검색으로 해당 엔트리를 반환한다

#### Scenario RA-002-4: 텍스트 매치 실패 후 벡터 검색 Fallback (고신뢰)

- **GIVEN** `error_kb`에 텍스트 정확/접두사 매치가 없지만, 임베딩이 있는 의미적 유사 엔트리(cosine distance 0.15)가 존재
- **WHEN** `searchErrorKB(normalizedError)`를 호출하면
- **THEN** 벡터 유사도 검색으로 해당 엔트리를 반환한다

#### Scenario RA-002-4b: 저신뢰 벡터 매칭 + 키워드 검증 통과

- **GIVEN** `error_kb`에 텍스트 매치가 없고, 벡터 검색 결과 distance 0.80(저신뢰 구간)인 엔트리가 있으며, 쿼리와 매치 결과 간 공통 키워드("module", "not", "found")가 1개 이상 존재
- **WHEN** `searchErrorKB(normalizedError)`를 호출하면
- **THEN** 키워드 검증을 통과하여 해당 엔트리를 반환한다

#### Scenario RA-002-4c: 저신뢰 벡터 매칭 + 키워드 검증 실패

- **GIVEN** `error_kb`에 텍스트 매치가 없고, 벡터 검색 결과 distance 0.82(저신뢰 구간)인 엔트리가 있지만, 쿼리와 매치 결과 간 공통 키워드가 0개
- **WHEN** `searchErrorKB(normalizedError)`를 호출하면
- **THEN** 키워드 검증 실패로 `null`을 반환한다

#### Scenario RA-002-5: DB 부재 시

- **GIVEN** `self-gen.db` 파일이 존재하지 않는 환경
- **WHEN** `searchErrorKB(normalizedError)`를 호출하면
- **THEN** `null`을 반환한다

---

### REQ-RA-003: 에러 해결 기록 (recordResolution) — UPSERT 패턴

시스템은 에러가 해결되었을 때 해결 이력을 `error_kb` 테이블에 기록해야 한다(SHALL). UPSERT 패턴으로 동일 정규화 에러의 중복 엔트리를 방지한다(SHALL). 기록 시점에는 임베딩을 생성하지 않는다(성능상 배치 처리).

기록 내용:
1. 정규화된 에러 메시지 (`error_normalized`) (SHALL)
2. 원본 에러 메시지 (`error_raw`) (SHOULD)
3. 해결 방법 (`resolution`, JSON 문자열) (SHALL)
4. 해결에 사용된 도구명 (`resolved_by`) (SHOULD)
5. 해결 도구 시퀀스 (`tool_sequence`, JSON 배열 문자열) (SHOULD)
6. ISO 타임스탬프 `ts`, `use_count: 1` (SHALL)
7. 임베딩은 기록하지 않음 — SessionEnd 배치에서 `vec_error_kb`에 별도 생성 (SHALL)

UPSERT SQL:
```sql
INSERT INTO error_kb (ts, error_normalized, error_raw, resolution, resolved_by, tool_sequence, use_count)
VALUES (?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(error_normalized) DO UPDATE SET
  ts = excluded.ts,
  resolution = excluded.resolution,
  resolved_by = excluded.resolved_by,
  tool_sequence = excluded.tool_sequence,
  use_count = use_count + 1
```

> **전제조건**: `error_normalized` 컬럼에 UNIQUE 제약 조건이 설정되어 있어야 한다 (9장 스키마 참조).

#### Scenario RA-003-1: 새 에러의 정상적인 해결 기록

- **GIVEN** 에러 `"Module not found <STR>"`가 `Edit` 도구 사용 후 해결되었고, 동일 에러가 `error_kb`에 없을 때
- **WHEN** `recordResolution(normalizedError, { errorRaw: "Module not found 'foo'", resolvedBy: "Edit", toolSequence: ["Read", "Edit"] })`를 호출하면
- **THEN** `error_kb` 테이블에 `use_count: 1`로 새 행이 INSERT된다 (임베딩은 SessionEnd 배치에서 `vec_error_kb`에 생성)

#### Scenario RA-003-2: 기존 에러 재해결 시 UPSERT

- **GIVEN** `error_kb`에 `error_normalized = "Module not found <STR>"` 엔트리가 `use_count: 3`으로 이미 존재
- **WHEN** 동일 정규화 에러로 `recordResolution()`을 호출하면
- **THEN** 기존 행의 `resolution`, `resolved_by`, `tool_sequence`, `ts`가 갱신되고 `use_count`가 4로 증가한다

#### Scenario RA-003-3: DB가 아직 없을 때

- **GIVEN** `self-gen.db` 파일이 존재하지 않는 환경
- **WHEN** `recordResolution()`을 호출하면
- **THEN** DB와 테이블이 자동 생성되고 엔트리가 기록된다

---

### REQ-RA-004: error_kb 테이블 스키마 준수

모든 error_kb 엔트리는 테이블 스키마를 준수해야 한다(SHALL).

필수 컬럼:
- `ts` (TEXT): ISO 8601 타임스탬프 (SHALL)
- `error_normalized` (TEXT): 정규화된 에러 메시지 (SHALL)

선택 컬럼:
- `error_raw` (TEXT): 원본 에러 메시지 (SHOULD)
- `resolution` (TEXT): 해결 방법 (SHOULD)
- `resolved_by` (TEXT): 해결 도구명 (SHOULD)
- `tool_sequence` (TEXT): 해결 도구 시퀀스 JSON 배열 (SHOULD)
- `use_count` (INTEGER): KB 조회 횟수, 기본값 0 (SHALL)
- `last_used` (TEXT): 마지막 조회 시각 (SHOULD)
- 임베딩은 `vec_error_kb` 가상 테이블에 별도 저장 (배치 생성, SHOULD)

#### Scenario RA-004-1: 필수 컬럼 누락 시

- **GIVEN** `error_normalized` 값이 NULL인 INSERT 시도
- **WHEN** DB에 기록을 시도하면
- **THEN** NOT NULL 제약 조건에 의해 INSERT가 실패한다

---

### REQ-RA-005: 배치 임베딩 생성 (generateErrorEmbeddings)

시스템은 SessionEnd 시점에 임베딩이 없는 error_kb 엔트리에 대해 벡터 임베딩을 배치 생성해야 한다(SHALL).

1. `vec_error_kb`에 임베딩이 없는 엔트리를 조회한다 (SHALL)
   ```sql
   SELECT id, error_normalized FROM error_kb WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)
   ```
2. `db.mjs`의 `generateEmbeddings(texts)` 함수를 사용하여 벡터를 생성한다 (SHALL)
3. 생성된 벡터를 `vec_error_kb` 가상 테이블에 삽입한다 (SHALL)
   ```sql
   DELETE FROM vec_error_kb WHERE error_kb_id = ?;
   INSERT INTO vec_error_kb (error_kb_id, embedding) VALUES (?, ?);
   ```
4. 임베딩 생성 실패 시 해당 엔트리를 건너뛰고 다음 엔트리를 계속 처리해야 한다(SHALL)
5. 한 번에 최대 50건씩 배치 처리하여 `claude --print` 호출 횟수를 최소화한다(SHOULD)

#### Scenario RA-005-1: 새 엔트리에 임베딩 배치 생성

- **GIVEN** `error_kb`에 `vec_error_kb`에 임베딩이 없는 엔트리 5건이 존재
- **WHEN** SessionEnd에서 `generateErrorEmbeddings()`가 호출되면
- **THEN** 5건 모두에 float[384] 벡터 임베딩이 생성되어 `vec_error_kb` 테이블에 저장된다

#### Scenario RA-005-2: 임베딩 생성 부분 실패

- **GIVEN** `error_kb`에 `vec_error_kb`에 임베딩이 없는 엔트리 3건 중 2번째 엔트리의 임베딩 생성이 실패
- **WHEN** `generateErrorEmbeddings()`가 호출되면
- **THEN** 1번째와 3번째 엔트리는 정상적으로 `vec_error_kb`에 임베딩이 저장되고, 2번째는 `vec_error_kb`에 엔트리가 생성되지 않는다

#### Scenario RA-005-3: 임베딩이 없는 엔트리가 없을 때

- **GIVEN** `error_kb`의 모든 엔트리에 대응하는 `vec_error_kb` 임베딩이 이미 존재
- **WHEN** `generateErrorEmbeddings()`가 호출되면
- **THEN** 아무 작업 없이 즉시 반환한다

---

## 비기능 요구사항

### 성능

- `searchErrorKB()` 호출은 50ms 이내에 완료되어야 한다(SHOULD)
- 벡터 검색은 sqlite-vec 인덱스를 활용하여 10,000건 이상에서도 성능 저하 없이 동작해야 한다(SHOULD)
- 임베딩 배치 생성은 SessionEnd 시점에만 수행하여 실시간 훅 성능에 영향을 주지 않아야 한다(SHALL)

### 안정성

- 모든 함수는 예외 발생 시 `null` 또는 빈 값을 반환하고 프로세스를 중단하지 않아야 한다(SHALL)
- DB 접근 실패 시 graceful하게 `null`을 반환해야 한다(SHALL)

---

## 제약사항

- `better-sqlite3` 패키지를 사용하여 SQLite 접근 (SHALL)
- `sqlite-vec` 확장을 로드하여 벡터 연산 수행 (SHALL)
- `normalizeError()`는 이 모듈이 단일 소유자(Single Owner)이며, 다른 모듈은 이 모듈에서 import하여 사용 (SHALL)
- DB 경로: `~/.self-generation/data/self-gen.db` (SHALL)
- 임베딩 차원: 384 (float 배열) (SHALL)
- 임베딩 생성에 `db.mjs`의 `generateEmbeddings()` 유틸리티 사용 (SHALL) — Transformers.js `paraphrase-multilingual-MiniLM-L12-v2` 모델 기반, async 함수

---

## 비고

### 벡터 검색 도입 배경

기존 JSONL 기반의 텍스트 매칭(정확 매치 + substring fallback)은 의미적으로 유사하지만 표현이 다른 에러를 매칭하지 못하는 한계가 있었다. 예를 들어:
- `"Cannot find module 'react'"` vs `"Module not found: Error: Can't resolve 'react'"`
- `"TypeError: x is not a function"` vs `"x is not callable"`

sqlite-vec 벡터 유사도 검색을 도입하여 이러한 의미적 유사 에러를 cosine distance 기반으로 매칭할 수 있다.

### 임베딩 전략

- **생성 시점**: 실시간 훅(2초 제한) 중에는 임베딩을 생성하지 않고, SessionEnd 배치에서 생성
- **Fallback**: 임베딩이 아직 없는 엔트리는 기존 텍스트 매칭(정확 + 접두사)으로 검색 가능
- **차원**: 384 (float 배열), Transformers.js `paraphrase-multilingual-MiniLM-L12-v2` 모델을 통해 생성
- **임계값**: cosine distance 0.76 미만을 유사 매치로 판정

---

## 용어 정의

| 용어 | 정의 |
|------|------|
| KB (Knowledge Base) | 에러 해결 이력을 축적하는 지식 베이스 |
| 정규화 (Normalization) | 에러 메시지에서 가변 요소를 제거하여 패턴 매칭이 가능한 형태로 변환하는 과정 |
| 벡터 유사도 검색 | sqlite-vec의 cosine distance를 사용하여 의미적으로 유사한 에러를 찾는 검색 방법 |
| Exact Text Match | error_normalized 컬럼과 검색어가 완전히 일치하는 텍스트 매칭 |
| Prefix Text Match | error_normalized의 앞 30자로 LIKE 검색하는 텍스트 매칭 |
| 임베딩 (Embedding) | 텍스트를 384차원 float 벡터로 변환한 수치 표현 |
| 배치 임베딩 | SessionEnd 시점에 일괄적으로 임베딩을 생성하는 전략 |
| sqlite-vec | SQLite 확장으로 벡터 연산(cosine distance 등)을 지원 |
