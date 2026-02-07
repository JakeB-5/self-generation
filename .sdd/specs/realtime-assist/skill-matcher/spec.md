---
id: skill-matcher
title: "스킬 매처 (Skill Matcher)"
status: draft
created: 2026-02-07
domain: realtime-assist
depends: data-collection/log-writer
constitution_version: "2.0.0"
---

# skill-matcher

> `lib/skill-matcher.mjs` — 사용자 프롬프트와 기존 커스텀 스킬 간의 벡터 유사도 매칭, 키워드 fallback, 스킬 파일에서 패턴 추출을 담당하는 유틸리티 모듈.

---

## 개요

skill-matcher는 사용자가 입력한 프롬프트를 분석하여, 이미 생성된 커스텀 스킬(`.claude/commands/*.md`) 중 관련 있는 스킬을 자동으로 감지한다. sqlite-vec 벡터 유사도 검색을 기본 매칭 전략으로 사용하며, 임베딩이 없는 경우 키워드 매칭(50% 이상 임계값)으로 fallback한다. 벡터 검색은 언어 간 매칭(한국어 프롬프트 → 영어 스킬)을 자연스럽게 지원하므로, 기존 시노님맵이 불필요하다.

### 파일 위치

- 모듈: `~/.self-generation/lib/skill-matcher.mjs`
- 데이터: `~/.self-generation/data/self-gen.db` (`skill_embeddings` 테이블)

### skill_embeddings 테이블 스키마

```sql
CREATE TABLE skill_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,       -- skill file name (without .md)
  source_path TEXT NOT NULL,       -- full path to skill file
  description TEXT,                -- extracted description from skill file
  keywords TEXT,                   -- JSON array of extracted keywords
  updated_at TEXT NOT NULL         -- ISO 8601 timestamp
);

-- Vector search virtual table (sqlite-vec)
CREATE VIRTUAL TABLE vec_skill_embeddings USING vec0(
  skill_id INTEGER PRIMARY KEY,   -- references skill_embeddings.id
  embedding float[384]
);
```

### 매칭 우선순위

1. 벡터 유사도 검색 (cosine distance < 0.76)
2. 키워드 패턴 매칭 (50% 이상 임계값, fallback)

---

## 요구사항

### REQ-RA-101: 스킬 목록 로드 및 DB 동기화 (loadSkills)

시스템은 전역 및 프로젝트 스킬 디렉토리에서 커스텀 스킬 목록을 로드하고, `skill_embeddings` 테이블에 동기화해야 한다(SHALL).

스캔 대상:
1. 전역 스킬: `~/.claude/commands/*.md` (SHALL)
2. 프로젝트 스킬: `<projectPath>/.claude/commands/*.md` (SHALL)
3. 각 스킬에 대해 `name` (파일명에서 `.md` 제거), `scope` (`global`|`project`), `content` (파일 내용)를 포함하는 객체 배열을 반환 (SHALL)
4. 디렉토리가 존재하지 않으면 해당 스코프는 건너뛴다(SHALL)
5. 각 스킬을 `skill_embeddings` 테이블에 upsert한다(SHALL):
   ```sql
   INSERT OR REPLACE INTO skill_embeddings (name, source_path, description, keywords, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ```
6. `description`은 스킬 파일 첫 번째 단락에서 추출하고, `keywords`는 `extractPatterns()`로 추출한 JSON 배열이다(SHOULD)

#### Scenario RA-101-1: 전역+프로젝트 스킬 로드 및 DB 동기화

- **GIVEN** `~/.claude/commands/`에 `deploy.md`가 있고, 프로젝트 `.claude/commands/`에 `test-api.md`가 있을 때
- **WHEN** `loadSkills(projectPath)`를 호출하면
- **THEN** `[{ name: "deploy", scope: "global", content: "..." }, { name: "test-api", scope: "project", content: "..." }]`를 반환하고, `skill_embeddings` 테이블에 두 스킬이 upsert된다

#### Scenario RA-101-2: 스킬 디렉토리 부재 시

- **GIVEN** `~/.claude/commands/` 디렉토리가 존재하지 않는 환경
- **WHEN** `loadSkills(null)`을 호출하면
- **THEN** 빈 배열 `[]`을 반환한다

---

### REQ-RA-102: 프롬프트-스킬 매칭 (matchSkill)

시스템은 사용자 프롬프트와 스킬 목록을 비교하여 가장 관련 있는 스킬을 반환해야 한다(SHALL).

2단계 매칭 전략 (우선순위 순서):
1. **벡터 유사도 검색 (primary)**: 프롬프트의 임베딩을 생성하고, `vec_skill_embeddings` 가상 테이블에서 cosine distance가 0.76 미만인 가장 유사한 스킬을 반환한다(SHALL). `skill_embeddings` 테이블과 JOIN한다.
   ```sql
   SELECT s.name, s.source_path, s.description, v.distance
   FROM vec_skill_embeddings v
   INNER JOIN skill_embeddings s ON s.id = v.skill_id
   WHERE v.embedding MATCH ? AND k = 1
   ORDER BY v.distance
   ```
   - distance < 0.76이면 `{ skill, confidence: 1.0 - distance }` 반환 (SHALL)
2. **키워드 패턴 매칭 (fallback)**: 벡터 검색 실패 또는 임베딩 미존재 시, 스킬 파일의 "감지된 패턴" 섹션에서 추출한 패턴 키워드 중 50% 이상이 프롬프트에 포함되면 해당 스킬을 반환한다(SHALL).
   - confidence: 매칭된 키워드 비율 (e.g., 3/4 = 0.75) (SHALL)
3. 매칭되는 스킬이 없으면 `null`을 반환 (SHALL)

#### Scenario RA-102-1: 벡터 유사도 매칭 성공

- **GIVEN** `skill_embeddings`에 `deploy` 스킬의 임베딩이 존재하고, 프롬프트 "서버에 배포해줘"와의 cosine distance가 0.15
- **WHEN** `matchSkill("서버에 배포해줘", skills)`를 호출하면
- **THEN** `{ skill: deploySkill, confidence: 0.85 }`를 반환한다

#### Scenario RA-102-2: 한국어 프롬프트로 영어 스킬 매칭 (교차 언어)

- **GIVEN** `skill_embeddings`에 영어로 작성된 `docker-build` 스킬의 임베딩이 존재
- **WHEN** `matchSkill("도커 이미지 빌드해줘", skills)`를 호출하면
- **THEN** 벡터 유사도 검색으로 `docker-build` 스킬을 반환한다

#### Scenario RA-102-3: 키워드 패턴 매칭 Fallback (50% 임계값)

- **GIVEN** 스킬에 임베딩이 없고, 추출된 패턴 키워드가 `["docker", "build", "image", "push"]`
- **WHEN** `matchSkill("docker image build", skills)`를 호출하면
- **THEN** 4개 중 3개(75%) 매칭이므로 해당 스킬을 반환한다

#### Scenario RA-102-4: 임계값 미달로 매칭 실패

- **GIVEN** 스킬 패턴 키워드가 `["deploy", "server", "production", "release"]`
- **WHEN** `matchSkill("deploy locally", skills)`를 호출하면
- **THEN** 4개 중 1개(25%)로 임계값(50%) 미달이므로 `null`을 반환한다

---

### REQ-RA-103: 스킬 임베딩 갱신 (refreshSkillEmbeddings)

시스템은 변경된 스킬 파일의 임베딩을 재생성해야 한다(SHALL).

1. `skill_embeddings` 테이블에서 `vec_skill_embeddings`에 임베딩이 없거나 `updated_at`이 소스 파일의 mtime보다 오래된 엔트리를 조회한다(SHALL)
2. 해당 스킬의 description + keywords 텍스트로 `await generateEmbeddings()`를 호출하여 벡터를 생성한다(SHALL) — Transformers.js 비동기 처리
3. 생성된 벡터를 `vec_skill_embeddings` 가상 테이블에 저장하고 `updated_at`을 갱신한다(SHALL)
   ```sql
   INSERT OR REPLACE INTO vec_skill_embeddings (skill_id, embedding) VALUES (?, ?);
   UPDATE skill_embeddings SET updated_at = ? WHERE name = ?;
   ```
4. 임베딩 생성 실패 시 해당 스킬을 건너뛰고 다음 스킬을 계속 처리해야 한다(SHALL)
5. SessionEnd 또는 SessionStart 시점에 호출되어야 한다(SHOULD)

#### Scenario RA-103-1: 새 스킬에 임베딩 생성

- **GIVEN** `skill_embeddings`에 `deploy` 스킬이 `embedding IS NULL`로 존재
- **WHEN** `refreshSkillEmbeddings()`가 호출되면
- **THEN** `deploy` 스킬의 description + keywords로 임베딩이 생성되어 `embedding` 컬럼에 저장된다

#### Scenario RA-103-2: 변경된 스킬 파일 감지

- **GIVEN** `deploy.md` 파일의 mtime이 `skill_embeddings`의 `updated_at`보다 최신
- **WHEN** `refreshSkillEmbeddings()`가 호출되면
- **THEN** `deploy` 스킬의 임베딩이 재생성되고 `updated_at`이 갱신된다

#### Scenario RA-103-3: 모든 임베딩이 최신일 때

- **GIVEN** `skill_embeddings`의 모든 엔트리에 유효한 임베딩이 존재하고 파일 변경 없음
- **WHEN** `refreshSkillEmbeddings()`가 호출되면
- **THEN** 아무 작업 없이 즉시 반환한다

---

### REQ-RA-104: 패턴 추출 (extractPatterns)

시스템은 스킬 파일 콘텐츠에서 "감지된 패턴" 섹션의 패턴 목록을 추출해야 한다(SHALL). 추출된 패턴은 키워드 fallback 매칭과 `skill_embeddings` 테이블의 `keywords` 컬럼 저장에 사용된다.

1. "감지된 패턴" 헤딩 이후, 다음 `#` 헤딩 전까지의 `- ` 접두사 항목을 추출 (SHALL)
2. 각 항목에서 `- ` 접두사와 양끝 따옴표를 제거 (SHALL)
3. "감지된 패턴" 섹션이 없으면 빈 배열을 반환 (SHALL)

#### Scenario RA-104-1: 패턴 섹션이 있는 스킬 파일

- **GIVEN** 스킬 파일에 `## 감지된 패턴\n- "docker build"\n- "이미지 빌드"\n## 사용법` 내용이 있을 때
- **WHEN** `extractPatterns(content)`를 호출하면
- **THEN** `["docker build", "이미지 빌드"]`를 반환한다

#### Scenario RA-104-2: 패턴 섹션이 없는 스킬 파일

- **GIVEN** 스킬 파일에 "감지된 패턴" 섹션이 없을 때
- **WHEN** `extractPatterns(content)`를 호출하면
- **THEN** `[]`를 반환한다

---

## 비기능 요구사항

### 성능

- `matchSkill()` 호출은 20ms 이내에 완료되어야 한다(SHOULD)
- 벡터 검색은 sqlite-vec 인덱스를 활용하여 스킬 100개 이상에서도 성능 저하 없이 동작해야 한다(SHOULD)
- `refreshSkillEmbeddings()`는 세션 경계(SessionEnd/SessionStart)에만 수행하여 실시간 성능에 영향을 주지 않아야 한다(SHALL)

### 안정성

- 모든 함수는 예외 발생 시 `null` 또는 빈 값을 반환하고 프로세스를 중단하지 않아야 한다(SHALL)

---

## 제약사항

- `better-sqlite3` 패키지를 사용하여 SQLite 접근 (SHALL)
- `sqlite-vec` 확장을 로드하여 벡터 연산 수행 (SHALL)
- 키워드 매칭(fallback)은 대소문자 무시(case-insensitive)로 수행 (SHALL)
- 키워드는 3자 이상인 단어만 대상으로 한다 (SHALL)
- 임베딩 차원: 384 (float 배열) (SHALL)
- 임베딩 생성에 `db.mjs`의 `generateEmbeddings()` 유틸리티 사용 (SHALL) — Transformers.js `paraphrase-multilingual-MiniLM-L12-v2` 모델 기반, async 함수

---

## 비고

### 벡터 검색 도입에 따른 변경점

기존 시노님맵(synonym map) 기반 매칭은 AI 배치 분석에서 스킬별 동의어 목록을 수동 생성해야 했으며, 새로운 표현이나 교차 언어 매칭에 한계가 있었다. 벡터 유사도 검색 도입으로:

- **시노님맵 제거**: 벡터 검색이 의미적 유사성을 자연스럽게 처리하므로 별도 동의어 관리 불필요
- **교차 언어 매칭**: 한국어 프롬프트로 영어 스킬을, 영어 프롬프트로 한국어 스킬을 매칭 가능
- **키워드 fallback 유지**: 임베딩이 아직 없는 새 스킬에 대해 기존 키워드 매칭을 fallback으로 보존

### Fallback 전략

임베딩이 없는 스킬(새로 추가되어 아직 배치 처리 전)은 `extractPatterns()`로 추출된 키워드와 50% 임계값 매칭으로 검색 가능하다. 이는 시스템 초기 구동 시나 새 스킬 추가 직후에도 매칭이 동작하도록 보장한다.

---

## 용어 정의

| 용어 | 정의 |
|------|------|
| 벡터 유사도 검색 | sqlite-vec의 cosine distance를 사용하여 의미적으로 유사한 스킬을 찾는 검색 방법 |
| 키워드 매칭 | 스킬 파일의 패턴 키워드와 프롬프트 단어 간 포함 여부 비교 (fallback) |
| 감지된 패턴 | 스킬 파일 내 매칭 패턴을 정의한 마크다운 섹션 |
| 커스텀 스킬 | `.claude/commands/*.md`에 정의된 사용자 정의 명령어 |
| 임계값 (Threshold) | 키워드 매칭 비율이 이 값 이상이어야 매칭으로 판정 (50%) |
| 임베딩 (Embedding) | 텍스트를 384차원 float 벡터로 변환한 수치 표현 |
| 교차 언어 매칭 | 서로 다른 언어의 프롬프트와 스킬을 벡터 유사도로 매칭하는 기능 |
| skill_embeddings | 스킬 메타데이터와 벡터 임베딩을 저장하는 SQLite 테이블 |
