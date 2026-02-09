# 체크리스트: skill-matcher

## 스펙 완성도
- [ ] 모든 REQ에 GIVEN-WHEN-THEN 시나리오 포함
- [ ] RFC 2119 키워드 적절히 사용 (SHALL/SHOULD)
- [ ] depends 필드 정확: data-collection/log-writer

## DESIGN.md 일치

### REQ-RA-101: 스킬 목록 로드 (loadSkills)
- [ ] 전역 스킬 스캔: `~/.claude/commands/*.md` (`process.env.HOME` 사용)
- [ ] 프로젝트 스킬 스캔: `<projectPath>/.claude/commands/*.md`
- [ ] 반환 필드: name, scope, content, description, sourcePath
- [ ] description: 첫 번째 비어있지 않고 `#`으로 시작하지 않는 줄 (없으면 null)
- [ ] 디렉토리 없으면 해당 스코프 건너뛰기 (`existsSync()` 체크)
- [ ] `.md` 확장자 파일만 스캔
- [ ] DB 동기화는 수행하지 않음 (REQ-RA-103에서 별도 수행)

### REQ-RA-102: 프롬프트-스킬 매칭 (matchSkill)
- [ ] **1단계 (primary)**: 벡터 유사도 검색
- [ ] `generateEmbeddings([prompt])` 호출하여 프롬프트 임베딩 생성
- [ ] `vectorSearch('skill_embeddings', 'vec_skill_embeddings', embedding, 1)` 실행
- [ ] distance < 0.76이면 매치로 판정
- [ ] 벡터 매치 반환: `{ name, match: 'vector', confidence: 1 - distance, scope }`
- [ ] 벡터 검색 실패 시 예외 흡수하고 키워드 매칭으로 폴스루
- [ ] **2단계 (fallback)**: 키워드 패턴 매칭
- [ ] `extractPatterns(content)`로 패턴 키워드 추출, 50% 이상 임계값
- [ ] 프롬프트와 패턴 모두 소문자 비교 (`toLowerCase()`)
- [ ] 3자 이상 단어만 매칭 대상
- [ ] 키워드 매치 반환: `{ name, match: 'keyword', confidence: matchCount / patternWords.length, scope }`
- [ ] 매칭 없으면 `null` 반환

### REQ-RA-103: 스킬 임베딩 갱신 (refreshSkillEmbeddings)
- [ ] `vec_skill_embeddings`에 임베딩 없거나 `updated_at`이 소스 파일 mtime보다 오래된 엔트리 조회
- [ ] description + keywords 텍스트로 `await generateEmbeddings()` 호출
- [ ] `INSERT OR REPLACE INTO vec_skill_embeddings (skill_id, embedding) VALUES (?, ?);`
- [ ] `UPDATE skill_embeddings SET updated_at = ? WHERE name = ?;`
- [ ] 임베딩 생성 실패 시 해당 스킬 건너뛰고 다음 계속 처리
- [ ] SessionEnd 또는 SessionStart 시점에 호출 (SHOULD)

### REQ-RA-104: 패턴 추출 (extractPatterns)
- [ ] "감지된 패턴" 헤딩 이후, 다음 `#` 헤딩 전까지의 `- ` 접두사 항목 추출
- [ ] 각 항목에서 `- ` 접두사와 양끝 따옴표 제거
- [ ] "감지된 패턴" 섹션 없으면 빈 배열 반환

## 교차 참조

### data-collection/log-writer 인터페이스
- [ ] `getDb()` 함수로 DB 접근
- [ ] `generateEmbeddings(texts)` 함수 사용 (async, 384차원)
- [ ] `vectorSearch(tableName, vecTableName, embedding, limit)` 함수 사용

### hooks 통합
- [ ] prompt-logger.mjs: `matchSkill(prompt, loadSkills())` 호출하여 스킬 감지
- [ ] ai-analyzer.mjs: `loadSkills()`로 기존 스킬 목록을 가져와 프롬프트에 주입 (중복 제안 방지)
- [ ] feedback-tracker.mjs: `findStaleSkills()` 내부에서 `loadSkills()` 호출

## 테스트 계획

### 스킬 목록 로드 테스트
- [ ] Scenario RA-101-1: 전역+프로젝트 스킬 로드
- [ ] Scenario RA-101-2: 스킬 디렉토리 부재 시 빈 배열 반환
- [ ] Scenario RA-101-3: 프로젝트 경로 없이 전역만 로드

### 프롬프트-스킬 매칭 테스트
- [ ] Scenario RA-102-1: 벡터 유사도 매칭 성공 (distance 0.15)
- [ ] Scenario RA-102-2: 한국어 프롬프트 → 영어 스킬 매칭 (교차 언어)
- [ ] Scenario RA-102-3: 키워드 패턴 매칭 fallback (50% 임계값, 75% 매칭)
- [ ] Scenario RA-102-4: 임계값 미달로 매칭 실패 (25%)
- [ ] Scenario RA-102-5: 벡터 검색 실패 → 키워드 폴백

### 스킬 임베딩 갱신 테스트
- [ ] Scenario RA-103-1: 새 스킬에 임베딩 생성
- [ ] Scenario RA-103-2: 변경된 스킬 파일 감지 (mtime > updated_at)
- [ ] Scenario RA-103-3: 모든 임베딩이 최신일 때 즉시 반환

### 패턴 추출 테스트
- [ ] Scenario RA-104-1: 패턴 섹션이 있는 스킬 파일
- [ ] Scenario RA-104-2: 패턴 섹션이 없는 스킬 파일

## 비기능 요구사항

### 성능
- [ ] `matchSkill()` 호출 20ms 이내 (SHOULD)
- [ ] 벡터 검색은 sqlite-vec 인덱스 활용하여 스킬 100개 이상에서도 성능 저하 없음
- [ ] `refreshSkillEmbeddings()`는 세션 경계에만 수행

### 안정성
- [ ] 모든 함수는 예외 발생 시 `null` 또는 빈 값 반환

## 제약사항 검증
- [ ] `better-sqlite3` + `sqlite-vec` 사용
- [ ] 키워드 매칭은 대소문자 무시 (case-insensitive)
- [ ] 키워드는 3자 이상인 단어만 대상
- [ ] 임베딩 차원: 384 (float 배열)
- [ ] 임베딩 생성에 `db.mjs`의 `generateEmbeddings()` 사용

## 벡터 검색 도입 변경점
- [ ] 시노님맵 제거 검증
- [ ] 교차 언어 매칭 기능 검증
- [ ] 키워드 fallback 유지 검증
