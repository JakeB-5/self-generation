---
feature: batch-embeddings
created: 2026-02-09
total: 12
completed: 0
---

# 작업 목록: batch-embeddings

## 개요

- 총 작업 수: 12개
- 예상 복잡도: 중간

---

## 작업 목록

### Phase 1: 기반 구축

- [ ] [P1] `lib/batch-embeddings.mjs` 파일 생성 및 import 설정 (`db.mjs`, `skill-matcher.mjs`, `embedding-client.mjs`)
- [ ] [P1] `process.argv[2]` 인자 파싱 및 최상위 try-catch + `process.exit(0)` 래퍼 작성

### Phase 2: 임베딩 데몬 대기

- [ ] [P2] 10초 시작 지연 구현 (`await new Promise(r => setTimeout(r, 10000))`)
- [ ] [P2] `isServerRunning()` → `startServer()` → 15회 × 1초 대기 루프 구현

### Phase 3: 에러 KB 배치 임베딩

- [ ] [P2] `getDb()` 연결 및 `db.pragma('busy_timeout = 10000')` 설정
- [ ] [P2] 미임베딩 에러 KB 조회 (`WHERE id NOT IN (SELECT error_kb_id FROM vec_error_kb)`)
- [ ] [P2] `generateEmbeddings(texts)` 호출 및 `Float32Array` → `Buffer` 변환 후 `vec_error_kb`에 DELETE + INSERT

### Phase 4: 스킬 임베딩 갱신 (v9: 500자 절단)

- [ ] [P2] `loadSkills(projectPath)` 호출 및 스킬 목록 순회
- [ ] [P2] 스킬 content 500자 절단 처리 — `skill.content.slice(0, 500)` 명시 적용
- [ ] [P2] `skill_embeddings` 테이블 UPSERT — `INSERT OR REPLACE` + `extractPatterns()` → `keywords` JSON
- [ ] [P2] `skillId` 획득 (lastInsertRowid 폴백) 및 `vec_skill_embeddings`에 DELETE + INSERT

### Phase 5: 테스트 (v9: 500자 절단 검증)

- [ ] [P3] [->T] 단위 테스트 — 미임베딩 조회, Buffer 변환, skillId 획득 로직, 스킬 500자 절단
- [ ] [P3] [->T] 통합 테스트 — 전체 배치 플로우 (에러 KB + 스킬), 데몬 미실행 시 graceful 종료, exit 0 보장, 스킬 content 절단 동작

---

## 의존성 그래프

```mermaid
graph LR
    A[파일 생성 + import] --> B[try-catch 래퍼]
    B --> C[10초 지연]
    C --> D[데몬 대기 루프]
    D --> E[busy_timeout 설정]
    E --> F[에러 KB 배치 임베딩]
    F --> G[스킬 임베딩 갱신]
    F & G --> H[단위 테스트]
    H --> I[통합 테스트]
```

---

## 마커 범례

| 마커 | 의미 |
|------|------|
| [P1-3] | 우선순위 |
| [->T] | 테스트 필요 |
| [US] | 불확실/검토 필요 |
