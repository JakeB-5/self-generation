[English](SETUP.md)

# Self-Generation 설정 및 사용 가이드

Self-Generation은 Claude Code 사용 패턴을 자동으로 수집하고 분석하여, 반복되는 작업을 커스텀 스킬, CLAUDE.md 지침, 훅 워크플로우로 자동 개선하는 시스템입니다. 이 가이드는 설치부터 사용, 문제 해결까지 모든 단계를 다룹니다.

---

## 목차

1. [사전 요구사항](#1-사전-요구사항)
2. [설치](#2-설치)
3. [설정 (config.json)](#3-설정-configjson)
4. [기본 사용 가이드](#4-기본-사용-가이드)
5. [제거](#5-제거)
6. [트러블슈팅](#6-트러블슈팅)
7. [프라이버시 & 보안](#7-프라이버시--보안)

---

## 1. 사전 요구사항

### Node.js 버전

Self-Generation은 Node.js의 `better-sqlite3` 네이티브 바인딩을 사용합니다. 버전 호환성이 중요합니다.

**필수**: Node.js v22 (또는 v18, v20)
**주의**: Node.js v24는 better-sqlite3 네이티브 빌드 실패 — 피하세요

### Node 버전 확인 및 설정

```bash
# 현재 버전 확인
node --version

# nvm 사용 권장 (Node 버전 관리)
# macOS/Linux:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# nvm 재시작 (터미널 닫고 다시 열기 또는):
source ~/.bashrc

# Node v22 설치 및 사용
nvm install 22
nvm use 22

# 확인
node --version  # v22.x.x 이상이어야 함
```

### 빌드 도구

`better-sqlite3` 컴파일에 필요합니다.

**macOS:**
```bash
# Xcode Command Line Tools 설치
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

### Claude Code 설치

Claude Code CLI가 설치되어 있어야 합니다 (`claude --version`으로 확인).

---

## 2. 설치

### Step 1: 저장소 클론

```bash
# 저장소 클론
git clone https://github.com/JakeB-5/self-generation.git
cd self-generation

# (또는 이미 클론된 경우)
cd /path/to/self-generation
```

### Step 2: 의존성 설치

```bash
# 프로젝트 루트에서
npm install

# 설치 확인 (약 2-3분 소요, 네이티브 컴파일)
npm test  # 전체 251개 테스트가 통과해야 함
```

출력 예:
```
251 tests, 0 failures
ok - All tests passed
```

문제 발생 시 [트러블슈팅](#6-트러블슈팅)을 참고하세요.

### Step 3: 시스템 설치

```bash
# Self-Generation 시스템 설치
node bin/install.mjs

# 출력 예:
# 📁 디렉토리 구조 생성 완료
# 📦 package.json 확인 완료
# 📦 의존성 설치 완료
# ⚙️  config.json 초기화 완료
# 🔗 settings.json에 훅 등록 완료
# ✅ self-generation 설치가 완료되었습니다.
```

#### 생성되는 디렉토리 구조

설치 후 `~/.self-generation/` 디렉토리가 생성됩니다:

```
~/.self-generation/
├── config.json                 # 시스템 설정
├── data/
│   └── self-gen.db            # 데이터베이스 (SQLite)
├── hooks/                      # 8개 훅 스크립트
│   ├── prompt-logger.mjs       # UserPromptSubmit 이벤트
│   ├── tool-logger.mjs         # PostToolUse 이벤트
│   ├── error-logger.mjs        # PostToolUseFailure 이벤트
│   ├── pre-tool-guide.mjs      # PreToolUse 이벤트
│   ├── subagent-context.mjs    # SubagentStart 이벤트
│   ├── subagent-tracker.mjs    # SubagentStop 이벤트
│   ├── session-summary.mjs     # SessionEnd 이벤트
│   └── session-analyzer.mjs    # SessionStart 이벤트
├── hooks/auto/                 # 자동 생성된 훅 워크플로우
├── lib/                        # 유틸리티 모듈 8개
├── prompts/
│   └── analyze.md             # AI 분석 프롬프트 템플릿
└── bin/                        # CLI 도구 4개
    ├── install.mjs
    ├── analyze.mjs
    ├── apply.mjs
    └── dismiss.mjs
```

#### 등록되는 훅 (8개)

| 이벤트 | 스크립트 | 목적 | 타임아웃 |
|--------|----------|------|---------|
| `UserPromptSubmit` | prompt-logger.mjs | 프롬프트 수집 + 스킬 매칭 | 5초 |
| `PostToolUse` | tool-logger.mjs | 도구 사용 + 해결 패턴 감지 | 5초 |
| `PostToolUseFailure` | error-logger.mjs | 에러 수집 + KB 검색 | 5초 |
| `PreToolUse` | pre-tool-guide.mjs | 파일 에러 이력 (Edit/Write/Bash/Task) | 5초 |
| `SubagentStart` | subagent-context.mjs | 에러 패턴 + AI 규칙 주입 | 5초 |
| `SubagentStop` | subagent-tracker.mjs | 에이전트 성능 추적 | 5초 |
| `SessionEnd` | session-summary.mjs | 세션 요약 + AI 분석 트리거 | 10초 |
| `SessionStart` | session-analyzer.mjs | 캐시 주입 + 컨텍스트 | 10초 |

#### ~/.claude/settings.json 변경 사항

설치 후 `~/.claude/settings.json`에 hooks 섹션이 추가됩니다:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "node ~/.self-generation/hooks/prompt-logger.mjs",
        "timeout": 5
      }
    ],
    "PostToolUse": [
      {
        "type": "command",
        "command": "node ~/.self-generation/hooks/tool-logger.mjs",
        "timeout": 5
      }
    ],
    // ... 이하 6개 훅
  }
}
```

### Step 4: 설치 확인

```bash
# config.json 확인
cat ~/.self-generation/config.json

# DB 초기화 확인
ls -lh ~/.self-generation/data/self-gen.db

# 훅 등록 확인
grep -A 5 "UserPromptSubmit" ~/.claude/settings.json
```

예상 출력:
```bash
$ cat ~/.self-generation/config.json
{
  "enabled": true,
  "collectPromptText": true,
  "retentionDays": 90,
  "analysisModel": "claude-sonnet-4-5-20250929"
}

$ ls -lh ~/.self-generation/data/self-gen.db
-rw-r--r--  1 user  staff  131K Feb  9 12:34 ~/.self-generation/data/self-gen.db
```

---

## 3. 설정 (config.json)

Self-Generation은 `~/.self-generation/config.json` 파일로 설정됩니다.

### 기본 설정 파일 내용

```json
{
  "enabled": true,
  "collectPromptText": true,
  "retentionDays": 90,
  "analysisModel": "claude-sonnet-4-5-20250929"
}
```

### 설정 필드 설명

#### `enabled` (boolean, 기본값: true)

전체 시스템의 활성화 여부를 제어합니다.

- `true`: 모든 훅이 활성화되어 데이터를 수집합니다
- `false`: 훅이 등록되어도 작동하지 않습니다

```bash
# 시스템 일시 중지
jq '.enabled = false' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# 시스템 재개
jq '.enabled = true' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### `collectPromptText` (boolean, 기본값: true)

프롬프트 전체 텍스트를 데이터베이스에 저장할지 여부를 제어합니다 (프라이버시).

- `true`: 프롬프트 전체 텍스트를 저장하여 더 정확한 패턴 분석 가능
- `false`: 프롬프트 메타데이터만 저장 (프롬프트 길이, 타임스탬프, 감정 분석 결과 등)

프라이버시가 중요한 경우:
```bash
jq '.collectPromptText = false' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### `retentionDays` (숫자, 기본값: 90)

데이터 보존 기간 (일 단위). 이 기간을 초과한 이벤트는 자동 삭제됩니다.

```bash
# 180일로 변경
jq '.retentionDays = 180' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# 영구 보관 (999999)
jq '.retentionDays = 999999' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### `analysisModel` (문자열, 기본값: claude-sonnet-4-5-20250929)

AI 패턴 분석에 사용할 Claude 모델을 지정합니다. 더 강력한 모델을 사용하면 더 정확한 분석 결과를 얻을 수 있지만 비용이 증가합니다.

가능한 값:
- `claude-opus-4-6` (최고 품질, 높은 비용)
- `claude-sonnet-4-5-20250929` (권장, 균형 잡힘)
- `claude-haiku-4-5-20251001` (빠름, 낮은 비용)

```bash
# 더 정확한 분석 (Opus)
jq '.analysisModel = "claude-opus-4-6"' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# 빠른 분석 (Haiku)
jq '.analysisModel = "claude-haiku-4-5-20251001"' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

### 설정 변경 확인

```bash
# 현재 설정 보기
cat ~/.self-generation/config.json

# JSON 유효성 검증
jq . ~/.self-generation/config.json
```

---

## 4. 기본 사용 가이드

### 자동 수집

설치 후 Claude Code를 사용하기만 하면 됩니다. 모든 데이터는 자동으로 수집됩니다.

**수집되는 데이터:**
- 프롬프트 (전체 또는 메타데이터)
- 도구 사용 (Bash, Read, Edit, Write, Grep, Task 등)
- 에러 메시지 및 해결 방법
- 세션 요약
- 스킬 사용

**프라이버시 보호:**
- Bash 명령어: 첫 단어(명령어명)만 저장
- `<private>` 태그: 자동 제거
- 에러 메시지: 경로, 숫자, 문자열 마스킹

### AI 패턴 분석 실행

최소 5개의 프롬프트를 수집한 후, 분석을 실행할 수 있습니다.

```bash
# 기본 분석 (최근 30일)
node ~/.self-generation/bin/analyze.mjs

# 분석 결과 예시:
# === Self-Generation AI 패턴 분석 (최근 30일) ===
#
# --- 반복 프롬프트 클러스터 ---
#
#   [5회] typescript-setup - TypeScript 프로젝트 초기화
#     "TypeScript 프로젝트 초기화해줘. eslint, prettier 포함해서."
#     "새 TS 프로젝트 만들어줘. 린터 설정도."
#     "타입스크립트 프로젝트 셋업해줘."
#
# --- 반복 도구 시퀀스 ---
#
#   [12회] Grep → Read → Edit → Bash (test 실행)
#
# --- 반복 에러 패턴 ---
#
#   [8회] "Module not found"
#     → 규칙: "npm install 후 테스트 실행"
#
# === 개선 제안 ===
#
# 1. [skill] typescript-init 스킬 생성
#    근거: 5회 반복된 TypeScript 프로젝트 초기화 패턴
#    제안: /ts-init 커스텀 스킬로 자동화
#
# 2. [claude_md] 프로젝트 CLAUDE.md에 규칙 추가
#    근거: "npm install이 모든 에러 해결의 첫 단계"
#    제안: CLAUDE.md에 "테스트 실패 시 먼저 npm install 실행" 추가
#
# ---
# 제안을 적용하려면: node ~/.self-generation/bin/apply.mjs <번호>
```

#### 분석 옵션

```bash
# 최근 60일 분석
node ~/.self-generation/bin/analyze.mjs --days 60

# 특정 프로젝트만 분석
node ~/.self-generation/bin/analyze.mjs --project-path /path/to/project

# 특정 프로젝트 (이름 기반)
node ~/.self-generation/bin/analyze.mjs --project my-project
```

### 제안 적용

분석 결과에서 마음에 드는 제안을 적용할 수 있습니다.

#### 1. 스킬(Skill) 적용

반복되는 작업을 자동화하는 커스텀 스킬을 생성합니다.

```bash
# 제안 1번 적용 (스킬)
node ~/.self-generation/bin/apply.mjs 1

# 출력 예:
# 스킬 생성: /Users/user/.claude/commands/ts-init.md

# 프로젝트 범위 스킬 생성
node ~/.self-generation/bin/apply.mjs 1 --project my-project

# 생성된 스킬 확인
cat ~/.claude/commands/ts-init.md

# 사용 방법: Claude Code에서 `/ts-init` 입력 (자동 완성)
```

생성된 스킬 파일 예:
```markdown
# /ts-init

AI가 감지한 반복 패턴에서 생성된 스킬입니다.

## 감지된 패턴
- 5회 반복된 TypeScript 프로젝트 초기화

## 실행 지침

TypeScript 프로젝트를 초기화합니다:
1. package.json 생성
2. ESLint + Prettier 설정
3. tsconfig.json 설정
```

#### 2. CLAUDE.md 규칙 적용

프로젝트 또는 전역 지침으로 반복되는 규칙을 추가합니다.

```bash
# 제안 2번 적용 (CLAUDE.md)
node ~/.self-generation/bin/apply.mjs 2

# 출력 예:
# CLAUDE.md 업데이트: /Users/user/.claude/CLAUDE.md

# 생성된 내용 확인
cat ~/.claude/CLAUDE.md

# 프로젝트 범위 규칙 적용
node ~/.self-generation/bin/apply.mjs 2 --project my-project

# 생성 위치:
# 프로젝트 범위: /path/to/project/.claude/CLAUDE.md
# 전역 범위: ~/.claude/CLAUDE.md
```

생성된 규칙 예:
```markdown
## 자동 감지된 규칙

- 테스트 실패 시 먼저 npm install 실행
- 새로운 의존성 추가 후 항상 npx tsc --noEmit으로 타입 확인
```

#### 3. 훅 워크플로우 적용

반복되는 도구 시퀀스를 자동 훅으로 등록합니다.

```bash
# 제안 3번 적용 (훅)
node ~/.self-generation/bin/apply.mjs 3

# 출력 예:
# ✅ 훅 스크립트 생성됨: ~/.self-generation/hooks/auto/workflow-xxxxx.mjs
#
# 수동 등록: ~/.claude/settings.json에 다음을 추가하세요:
#   "PostToolUse": ["~/.self-generation/hooks/auto/workflow-xxxxx.mjs"]
#
# 또는 자동 등록: node ~/.self-generation/bin/apply.mjs 3 --apply

# 자동으로 settings.json에 등록
node ~/.self-generation/bin/apply.mjs 3 --apply

# 등록 확인
cat ~/.claude/settings.json | jq '.hooks.PostToolUse'
```

### 제안 거부

마음에 들지 않는 제안은 거부할 수 있습니다. 거부된 패턴은 향후 분석에서 제외됩니다.

```bash
# 제안 ID로 거부
node ~/.self-generation/bin/dismiss.mjs "suggestion-abc123"

# 출력 예:
# 제안 거부 기록됨: suggestion-abc123
# 이 패턴은 향후 AI 분석 시 제외 컨텍스트로 전달됩니다.
```

### 데이터베이스 검사

데이터가 정상적으로 수집되는지 확인할 수 있습니다.

```bash
# SQLite CLI로 DB 검사
sqlite3 ~/.self-generation/data/self-gen.db

# DB 셀 프롬프트에서:
sqlite> SELECT COUNT(*) as event_count FROM events;
sqlite> SELECT type, COUNT(*) FROM events GROUP BY type;
sqlite> SELECT * FROM events LIMIT 1;
sqlite> .quit
```

---

## 5. 제거

### 훅만 제거 (데이터 보존)

```bash
# 훅 등록 제거 (settings.json에서만 제거)
node ~/self-generation/bin/install.mjs --uninstall

# 출력 예:
# ✅ self-generation 훅이 settings.json에서 제거되었습니다.
#    데이터 삭제: rm -rf ~/.self-generation

# 확인
grep -c "self-generation" ~/.claude/settings.json  # 0 또는 라인 수 없음
```

### 완전 제거 (데이터 포함)

```bash
# 훅 제거 + 모든 데이터 삭제
node ~/.self-generation/bin/install.mjs --uninstall --purge

# 출력 예:
# ✅ self-generation 훅이 settings.json에서 제거되었습니다.
# 🗑️  데이터 디렉토리와 소켓 파일이 삭제되었습니다.

# 확인
ls ~/.self-generation  # 디렉토리 없음 (또는 empty)
```

### 수동 정리

```bash
# 훅 제거 (보관)
rm -rf ~/.self-generation/hooks/

# DB만 삭제
rm ~/.self-generation/data/self-gen.db*

# 전체 삭제
rm -rf ~/.self-generation/

# settings.json에서 self-generation 훅 수동 제거
# (편집기에서 ~/.claude/settings.json 열기 → self-generation 관련 항목 삭제)
```

---

## 6. 트러블슈팅

### Node 버전 문제

#### 증상
```
error: 'sqlite3_vtab_alloc' is not a member of 'sqlite3'
npm ERR! gyp ERR! build error
```

#### 원인
Node.js v24는 better-sqlite3와 호환되지 않습니다.

#### 해결

```bash
# 현재 버전 확인
node --version

# v24인 경우, v22로 변경
nvm install 22
nvm use 22

# 의존성 재설치
rm -rf node_modules package-lock.json
npm install
```

### 훅이 동작하지 않을 때

#### 증상
- 프롬프트/도구 사용 데이터가 수집되지 않음
- DB 파일 수정 시간이 변경되지 않음

#### 원인
1. 훅이 settings.json에 등록되지 않음
2. `enabled: false` 설정
3. 훅 스크립트 경로 오류

#### 해결

```bash
# 1. settings.json에 훅이 등록되었는지 확인
grep -l "self-generation" ~/.claude/settings.json

# 2. enabled 설정 확인
jq '.enabled' ~/.self-generation/config.json  # true여야 함

# 3. 훅 스크립트 존재 확인
ls -la ~/.self-generation/hooks/

# 4. 다시 설치
node ~/.self-generation/bin/install.mjs --uninstall
node ~/self-generation/bin/install.mjs

# 5. Claude Code 재시작 (매우 중요!)
# Claude Code를 완전히 종료하고 재시작
```

### DB 잠금 문제

#### 증상
```
sqlite error: database is locked
```

#### 원인
여러 훅이 동시에 DB에 접근할 때 발생합니다. Self-Generation은 WAL(Write-Ahead Logging) 모드를 사용하여 이를 방지합니다.

#### 해결

```bash
# WAL 모드 확인
sqlite3 ~/.self-generation/data/self-gen.db "PRAGMA journal_mode;"
# 결과: wal

# DB 파일이 손상된 경우, 재초기화
rm ~/.self-generation/data/self-gen.db*
node ~/.self-generation/bin/install.mjs

# 또는 전체 재설치
rm -rf ~/.self-generation/
node ~/self-generation/bin/install.mjs
```

### 임베딩 데몬 문제

#### 증상
```
Error: connect ENOENT /tmp/self-gen-embed.sock
```

#### 원인
임베딩 데몬이 시작되지 않았습니다. 보통 첫 실행 시 ONNX 모델(120MB)을 다운로드할 때 발생합니다.

#### 해결

```bash
# 소켓 파일 확인
ls -la /tmp/self-gen-embed.sock

# 데몬 로그 확인 (있는 경우)
tail -20 ~/.self-generation/logs/daemon.log

# 재시작
kill $(lsof -t /tmp/self-gen-embed.sock) 2>/dev/null
# Claude Code 재시작

# 모델 다운로드 대기 (인터넷 연결 필요)
# 첫 실행 시 3-5분 소요
```

### npm 설치 실패

#### 증상
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

#### 원인
의존성 충돌 또는 손상된 npm 캐시.

#### 해결

```bash
# npm 캐시 정리
npm cache clean --force

# 전체 재설치
rm -rf node_modules package-lock.json
npm install --no-save

# 여전히 실패하면, npm/Node 재설치
nvm uninstall 22
nvm install 22
npm install
```

### 분석 실패

#### 증상
```
분석 실패: Error: claude not found
```

#### 원인
`claude` CLI 명령이 설치되지 않았거나 PATH에 없습니다.

#### 해결

```bash
# claude CLI 설치 확인
which claude
claude --version

# 설치되지 않은 경우
npm install -g @anthropic-ai/sdk

# 또는 Anthropic 공식 가이드 따르기
# https://docs.anthropic.com/en/docs/claude-code
```

### 데이터 수집 안 됨

#### 증상
- DB에 events 테이블이 있지만 레코드 없음
- `analyze.mjs` 실행 시 "데이터 부족" 메시지

#### 원인
- 훅이 작동하지 않음
- `collectPromptText: false`로 설정되어 프롬프트만 수집 중
- 최소 5개 이벤트 필요

#### 해결

```bash
# 1. 훅 동작 확인 (위 "훅이 동작하지 않을 때" 참고)

# 2. enabled 확인
jq '.enabled' ~/.self-generation/config.json

# 3. 강제 테스트 이벤트 생성
# Claude Code에서 간단한 작업 10번 반복 (Bash, Read, Edit 등)
# 또는 프로그래밍 방식으로:
node -e "
const db = require('better-sqlite3')('~/.self-generation/data/self-gen.db');
const count = db.prepare('SELECT COUNT(*) as cnt FROM events').get().cnt;
console.log('Events:', count);
"

# 4. 분석 재실행
node ~/.self-generation/bin/analyze.mjs --days 1
```

---

## 7. 프라이버시 & 보안

### 모든 데이터는 로컬에 저장됩니다

Self-Generation은 완전히 로컬에서 작동합니다. 수집된 데이터는 절대로 외부 서버로 전송되지 않습니다.

```bash
# 데이터 위치 확인
ls -la ~/.self-generation/data/

# 파일 크기
du -h ~/.self-generation/

# 데이터 백업
cp -r ~/.self-generation ~/.self-generation.backup
```

### 민감 정보 자동 보호

#### 1. Bash 명령어 - 첫 단어만 저장

```bash
# 입력: npm install --save-dev typescript
# 저장됨: npm
#
# 입력: ssh user@host.com
# 저장됨: ssh

# 이유: 패턴 인식에는 명령어명만 필요, 인자는 민감 정보일 수 있음
```

#### 2. `<private>` 태그 자동 제거

```
프롬프트 입력:
"내 API 키는 sk-xxxxx이고, <private>민감한 정보</private>입니다."

저장됨:
"내 API 키는 [REDACTED]이고, [REDACTED]입니다."
```

#### 3. 에러 메시지 정규화

```
원본:
"/Users/john/projects/myapp/src/index.ts:42:15 - error: Type 'string' is not assignable..."

저장됨:
"<PATH>:<N>:<N> - error: Type '<STR>' is not assignable..."

목적: 개인 경로, 줄 번호, 구체적 값을 마스킹하여 패턴만 분석
```

### 프라이버시 설정 - 프롬프트 수집 비활성화

프롬프트 전체 텍스트 저장을 비활성화할 수 있습니다. 이 경우 메타데이터만 저장됩니다.

```bash
# 프롬프트 수집 비활성화
jq '.collectPromptText = false' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json

# 확인
jq '.collectPromptText' ~/.self-generation/config.json  # false
```

이 설정이 활성화되면:

**저장되는 데이터:**
- 프롬프트 길이 (charCount)
- 타임스탬프
- 세션 ID, 프로젝트 정보

**저장되지 않는 데이터:**
- 프롬프트 전체 텍스트

### 데이터 삭제 정책

#### 자동 삭제

`config.json`의 `retentionDays` 설정에 따라 자동 삭제됩니다 (기본값: 90일).

```bash
# 현재 보존 기간 확인
jq '.retentionDays' ~/.self-generation/config.json

# 30일로 단축
jq '.retentionDays = 30' ~/.self-generation/config.json | \
  tee ~/.self-generation/config.json
```

#### 수동 삭제

```bash
# 특정 프로젝트 데이터만 삭제
sqlite3 ~/.self-generation/data/self-gen.db \
  "DELETE FROM events WHERE project_path = '/path/to/project';"

# 특정 날짜 이전 모든 데이터 삭제
sqlite3 ~/.self-generation/data/self-gen.db \
  "DELETE FROM events WHERE ts < '2025-01-09T00:00:00Z';"

# 전체 삭제
sqlite3 ~/.self-generation/data/self-gen.db \
  "DELETE FROM events; VACUUM;"
```

### 보안 고려사항

#### 1. 파일 권한

Self-Generation 디렉토리는 자동으로 적절한 권한으로 생성됩니다.

```bash
# 권한 확인 (사용자만 읽기/쓰기 가능해야 함)
ls -ld ~/.self-generation
# 예상: drwx------ (700)

# 필요시 권한 설정
chmod 700 ~/.self-generation
chmod 700 ~/.self-generation/data
chmod 600 ~/.self-generation/data/self-gen.db
```

#### 2. 네트워크 안전성

Self-Generation은 네트워크 통신이 필요합니다:

- **Claude API 호출**: Claude 헤드리스 모드 실행 시만 (AI 분석 시점)
- **모델 다운로드**: 첫 실행 시 ONNX 임베딩 모델 다운로드 (120MB)
- **Claude Code 통신**: 훅 스크립트는 로컬 프로세스이므로 네트워크 없음

#### 3. 임베딩 모델

`@xenova/transformers`는 로컬에서만 실행됩니다. 모델이나 데이터가 외부로 전송되지 않습니다.

```bash
# 임베딩 모델 캐시 위치
ls -la ~/.self-generation/models/
```

---

## 추가 리소스

### 주요 문서

- **DESIGN.md**: 전체 시스템 아키텍처 및 구현 사양 (3869줄)
- **CLAUDE.md**: 프로젝트 개요 및 기술 스택
- **.sdd/constitution.md**: 프로젝트 원칙 및 제약사항

### 명령어 요약

```bash
# 설치
npm install
node bin/install.mjs

# 분석 (30일 기본)
node ~/.self-generation/bin/analyze.mjs
node ~/.self-generation/bin/analyze.mjs --days 60
node ~/.self-generation/bin/analyze.mjs --project-path /path/to/project

# 제안 적용
node ~/.self-generation/bin/apply.mjs 1          # 제안 1 적용
node ~/.self-generation/bin/apply.mjs 1 --apply  # 훅 자동 등록

# 제안 거부
node ~/.self-generation/bin/dismiss.mjs "id"

# 제거
node bin/install.mjs --uninstall                 # 훅만 제거
node bin/install.mjs --uninstall --purge         # 전체 삭제

# 설정 수정
jq '.enabled = false' ~/.self-generation/config.json | tee ~/.self-generation/config.json
jq '.collectPromptText = false' ~/.self-generation/config.json | tee ~/.self-generation/config.json
jq '.retentionDays = 180' ~/.self-generation/config.json | tee ~/.self-generation/config.json

# 데이터 확인
sqlite3 ~/.self-generation/data/self-gen.db "SELECT COUNT(*) FROM events;"
cat ~/.self-generation/config.json | jq .
```

### FAQ

**Q: 설치 후 데이터가 수집되지 않습니다.**
A: Claude Code를 완전히 재시작하세요. 훅은 Claude Code 시작 시점에 로드됩니다.

**Q: 프롬프트를 저장하지 않으려면?**
A: `collectPromptText: false`로 설정하세요. 메타데이터만 저장됩니다.

**Q: 분석 결과가 만족스럽지 않습니다.**
A: 더 많은 데이터가 필요합니다 (최소 30개 이벤트 권장). 또는 `analysisModel`을 `claude-opus-4-6`으로 변경하여 더 정확한 분석을 시도하세요.

**Q: 기존 스킬을 덮어쓰나요?**
A: 아니오. 동일한 이름의 스킬이 존재하면 새 스킬 생성을 건너뜁니다.

**Q: 데이터를 다른 컴퓨터로 옮길 수 있나요?**
A: 네. `~/.self-generation/data/self-gen.db`를 복사하면 됩니다. DB는 자체 포함되어 있습니다.

---

**이 가이드는 Self-Generation v0.1.0을 기준으로 작성되었습니다. (2026-02-09)**
