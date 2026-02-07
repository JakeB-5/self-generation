# 참조: 외부 훅 시스템 구조

> 타 시스템에서 전달받은 전체 훅 흐름도. 자체 시스템 설계 시 참고용.

---

## 전체 훅 흐름도

### [세션 시작] SessionStart

```
SessionStart
────────────────────────────────
├─ learner-session-start.py .......... (5s) 학습 패턴 주입
├─ claude-mem mem-context-inject.cjs . (8s) 이전 세션 컨텍스트
└─ jarvis daemon-checker.py .......... (5s) PAODaemon 상태 확인
```

### [사용자 입력] UserPromptSubmit

```
UserPromptSubmit
────────────────────────────────
├─ skill-context-detector.ts ......... (5s) 스킬 자동 감지
├─ persona-activator.js .............. 페르소나 활성화
├─ todo-continuation-enforcer.js ..... 미완료 todo 감지
├─ auto-update-checker.js ............ 시스템 업데이트 확인
├─ plan-mode-analyzer.py ............. (5s) PRD/설계 모드 트리거
├─ keyword-detector.js (vibe) ........ (3s) Vibe 키워드 감지
└─ intent-router.py (Jarvis) ......... (3s) 의도 라우팅
```

### [도구 실행 전] PreToolUse

```
PreToolUse
────────────────────────────────
├─ [AskUserQuestion]
│  └─ smart-question-enhancer.py ..... (2s) 문맥 인식 질문 향상
│
├─ [Task]
│  └─ agent-skill-injector.ts ........ (5s) 에이전트에 스킬 주입
│
├─ [Bash]
│  └─ pre-commit-checker.js .......... (3s) git commit 품질 검사
│
├─ [Write]
│  └─ new-file-pattern-detector.js ... (3s) 새 파일 패턴 제안
│
└─ [Edit|Write]
   ├─ context-aware-load.py .......... (2s) 컨텍스트 기반 가이드
   ├─ error-warning-hook.js .......... (5s) 에러 경고
   └─ read-task-plan.py .............. (3s) task_plan.md 참조
```

### [도구 실행 후] PostToolUse

```
PostToolUse
────────────────────────────────
├─ [Write|Edit]
│  ├─ detect-pattern.py .............. (3s) 코드 변경 스킵 감지
│  ├─ update-plan-reminder.py ........ (3s) progress.md 상기
│  └─ post-edit-validator.js ......... (3s) 경량 검증 (JSON 등)
│
├─ [AI] Security Scanner ............. OWASP Top 10 검사
│
├─ [*] (모든 도구)
│  └─ error-success-resolver.js ...... (3s) pending 에러 자동 해결
│
└─ [Task]
   ├─ pattern-tracker.js ............. 에이전트 패턴 추적
   ├─ empty-task-response-detector.js  빈 응답 감지
   └─ background-notification.js ..... 백그라운드 알림
```

### [서브에이전트] SubagentStart / SubagentStop

```
SubagentStart
────────────────────────────────
└─ subagent-context-injector.js ...... (5s) 유형별 컨텍스트 주입

SubagentStop
────────────────────────────────
├─ subagent-performance-tracker.js ... (5s) 메트릭 추적
└─ subagent-quality-scorer.js ........ (5s) 품질 검사
```

### [도구 실패] PostToolUseFailure

```
PostToolUseFailure
────────────────────────────────
├─ error-failure-wrapper.js .......... (5s) 에러 KB 검색 + 제안
└─ [AI] Error Analyzer ............... 근본 원인 분석
```

### [세션 종료] Stop

```
Stop
────────────────────────────────
├─ todo-continuation-enforcer.js ..... 미완료 todo 체크
├─ check-task-complete.py ............ (3s) 작업 완료 확인
├─ auto-cleanup.py ................... (5s) 에러 로그/아카이브
├─ mem-summary.cjs ................... (10s) 세션 요약 생성
├─ session-advisor.py ................ (2s) 세션 어드바이스
└─ [AI] Session Coach ................ Jarvis 맞춤 코칭
```

---

## 훅별 구성 요소 요약

| 이벤트 | 훅 수 | 주요 언어 | 최대 timeout |
|--------|-------|----------|-------------|
| SessionStart | 3 | Python, JS | 8s |
| UserPromptSubmit | 7 | TS, JS, Python | 5s |
| PreToolUse | 7 (도구별) | Python, JS, TS | 5s |
| PostToolUse | 8 (도구별) | Python, JS, AI | 3s |
| SubagentStart | 1 | JS | 5s |
| SubagentStop | 2 | JS | 5s |
| PostToolUseFailure | 2 | JS, AI | 5s |
| Stop | 6 | JS, Python, AI | 10s |
| **합계** | **36** | | |

## 주요 특징

### 1. 다중 언어 혼용
- Python (.py): 분석/ML 계열 (learner, intent-router, plan-mode-analyzer)
- JavaScript (.js/.cjs): 경량 검사/상태 관리 (todo-enforcer, error-resolver)
- TypeScript (.ts): 타입 안전 필요한 복잡 로직 (skill-context-detector, agent-skill-injector)
- AI 훅: LLM 기반 분석 (Security Scanner, Error Analyzer, Session Coach)

### 2. AI 훅 (LLM 기반)
- Security Scanner: OWASP Top 10 검사 (PostToolUse)
- Error Analyzer: 근본 원인 분석 (PostToolUseFailure)
- Session Coach: Jarvis 맞춤 코칭 (Stop)

### 3. 외부 시스템 연동
- Jarvis: 의도 라우팅, 맞춤 코칭
- PAODaemon: 데몬 상태 관리
- claude-mem: 세션 간 메모리 시스템
- Vibe: 키워드 감지 시스템

### 4. 실시간 가이드 중심
- 입력 즉시 의도 분류 및 라우팅
- 편집 즉시 패턴 감지 및 경고
- 에러 즉시 KB 검색 및 제안
- 종료 시 세션 요약 및 코칭
