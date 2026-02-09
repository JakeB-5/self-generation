---
id: install-cli
title: "설치/제거 CLI"
status: draft
created: 2026-02-09
domain: infra
depends: null
constitution_version: "2.0.0"
---

# install-cli

> 시스템 설치/제거 CLI 스크립트 (`bin/install.mjs`). `~/.self-generation/` 디렉토리 구조 생성, `package.json` 생성 및 의존성 설치, `config.json` 초기화, `~/.claude/settings.json` 훅 등록을 자동화한다. `--uninstall` 플래그로 훅 해제 및 선택적 데이터 삭제를 지원한다. Phase 1 로드맵의 작업 0번으로, 모든 훅 스크립트 실행의 전제조건이다.

---

## 개요

### 대상 파일

| 대상 | 역할 |
|------|------|
| `~/.self-generation/bin/install.mjs` | 설치/제거 CLI 스크립트 |
| `~/.self-generation/package.json` | ES Module + 의존성 선언 |
| `~/.self-generation/config.json` | 시스템 설정 |
| `~/.claude/settings.json` | Claude Code 훅 등록 |

### 사용법

```bash
# 설치
node ~/.self-generation/bin/install.mjs

# 제거 (훅만 해제)
node ~/.self-generation/bin/install.mjs --uninstall

# 완전 제거 (훅 해제 + 데이터 삭제)
node ~/.self-generation/bin/install.mjs --uninstall --purge
```

### 의존 모듈

| import | 출처 |
|--------|------|
| `fs` (existsSync, mkdirSync, readFileSync, writeFileSync) | Node.js 내장 |
| `path` (join) | Node.js 내장 |
| `child_process` (execSync) | Node.js 내장 |
| `os` (homedir) | Node.js 내장 |

### 훅-이벤트 매핑 (8개)

| 이벤트 | 스크립트 | matcher |
|--------|----------|---------|
| `UserPromptSubmit` | `prompt-logger.mjs` | — |
| `PostToolUse` | `tool-logger.mjs` | — |
| `PostToolUseFailure` | `error-logger.mjs` | — |
| `PreToolUse` | `pre-tool-guide.mjs` | `Edit\|Write\|Bash\|Task` |
| `SubagentStart` | `subagent-context.mjs` | — |
| `SubagentStop` | `subagent-tracker.mjs` | — |
| `SessionEnd` | `session-summary.mjs` | — |
| `SessionStart` | `session-analyzer.mjs` | — |

---

## 요구사항

### REQ-INF-001: 디렉토리 구조 생성

시스템은 `~/.self-generation/` 하위에 필요한 디렉토리 구조를 생성해야 한다(SHALL). 이미 존재하는 디렉토리는 건너뛴다(멱등성).

생성 대상 디렉토리:
- `~/.self-generation/data/`
- `~/.self-generation/hooks/`
- `~/.self-generation/hooks/auto/`
- `~/.self-generation/lib/`
- `~/.self-generation/bin/`
- `~/.self-generation/prompts/`

#### Scenario: 최초 설치 시 디렉토리 생성

- **GIVEN** `~/.self-generation/` 디렉토리가 존재하지 않는 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** `data`, `hooks`, `hooks/auto`, `lib`, `bin`, `prompts` 6개 하위 디렉토리가 `mkdirSync({ recursive: true })`로 생성된다(SHALL)

#### Scenario: 기존 디렉토리 존재 시 멱등성

- **GIVEN** `~/.self-generation/` 디렉토리와 하위 디렉토리가 이미 존재하는 상태
- **WHEN** `node install.mjs`를 다시 실행하면
- **THEN** `{ recursive: true }` 옵션으로 에러 없이 완료된다(SHALL). 기존 파일은 보존된다

---

### REQ-INF-002: package.json 생성

시스템은 `~/.self-generation/package.json` 파일을 생성해야 한다(SHALL). 이미 존재하면 덮어쓰지 않는다(SHALL).

생성할 `package.json` 내용:

```json
{
  "name": "self-generation",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "sqlite-vec": "^0.1.0",
    "@xenova/transformers": "^2.17.0"
  }
}
```

#### Scenario: package.json 최초 생성

- **GIVEN** `~/.self-generation/package.json`이 존재하지 않는 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** 위 내용의 `package.json`이 생성된다(SHALL). `type: "module"`로 ES Module을 활성화하고, 3개 필수 의존성이 포함된다

#### Scenario: package.json 이미 존재

- **GIVEN** `~/.self-generation/package.json`이 이미 존재하는 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** 기존 `package.json`을 덮어쓰지 않는다(SHALL). 사용자가 수동으로 수정한 의존성 버전이 보존된다

---

### REQ-INF-003: npm 의존성 설치

시스템은 `npm install --production`을 실행하여 의존성을 설치해야 한다(SHALL).

#### Scenario: 의존성 정상 설치

- **GIVEN** `~/.self-generation/package.json`이 존재하는 상태
- **WHEN** `execSync('npm install --production', { cwd: SELF_GEN_DIR, stdio: 'inherit' })`가 실행되면
- **THEN** `better-sqlite3`, `sqlite-vec`, `@xenova/transformers` 패키지가 `node_modules/`에 설치된다(SHALL)

#### Scenario: npm install 실패

- **GIVEN** 네트워크 오류 또는 빌드 실패로 `npm install`이 실패하는 상태
- **WHEN** `execSync()`에서 예외가 발생하면
- **THEN** 에러 메시지를 출력하고 `process.exit(1)`로 종료한다(SHALL). 부분 설치 상태는 재실행으로 복구 가능하다

---

### REQ-INF-004: config.json 초기화

시스템은 `~/.self-generation/config.json` 파일을 기본값으로 초기화해야 한다(SHALL). 이미 존재하면 덮어쓰지 않는다(SHALL).

기본 설정값:

```json
{
  "enabled": true,
  "collectPromptText": true,
  "retentionDays": 90,
  "analysisModel": "claude-sonnet-4-5-20250929"
}
```

#### Scenario: config.json 최초 생성

- **GIVEN** `~/.self-generation/config.json`이 존재하지 않는 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** 기본 설정값으로 `config.json`이 생성된다(SHALL)

#### Scenario: config.json 이미 존재

- **GIVEN** `~/.self-generation/config.json`이 이미 존재하는 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** 기존 설정을 덮어쓰지 않는다(SHALL). 사용자 커스터마이징이 보존된다

---

### REQ-INF-005: settings.json 훅 등록

시스템은 `~/.claude/settings.json`에 8개 이벤트의 훅을 등록해야 한다(SHALL). 기존 설정과 다른 훅을 보존하면서 병합해야 한다(SHALL).

#### 훅 등록 형식

각 이벤트에 대해 다음 형식의 hook group을 추가한다.

각 훅의 timeout은 이벤트 유형에 따라 다르다(SHALL):
- **일반 훅**: timeout 5초 (UserPromptSubmit, PostToolUse, PostToolUseFailure, SubagentStop, PreToolUse, SubagentStart)
- **세션 훅**: timeout 10초 (SessionEnd, SessionStart) — AI 분석 트리거 및 컨텍스트 로딩에 추가 시간 필요

일반 이벤트 형식 (timeout: 5):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node <SELF_GEN_DIR>/hooks/<script>",
      "timeout": 5
    }
  ]
}
```

세션 이벤트 형식 (SessionEnd, SessionStart, timeout: 10):

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node <SELF_GEN_DIR>/hooks/<script>",
      "timeout": 10
    }
  ]
}
```

`PreToolUse` 이벤트의 경우 `matcher` 필드를 추가한다:

```json
{
  "matcher": "Edit|Write|Bash|Task",
  "hooks": [
    {
      "type": "command",
      "command": "node <SELF_GEN_DIR>/hooks/pre-tool-guide.mjs",
      "timeout": 5
    }
  ]
}
```

#### Scenario: settings.json 최초 등록

- **GIVEN** `~/.claude/settings.json`이 존재하지 않거나 `hooks` 키가 없는 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** `~/.claude/` 디렉토리를 생성하고(SHALL), `settings.json`에 8개 이벤트의 훅을 등록한다(SHALL)

#### Scenario: 기존 훅과 병합

- **GIVEN** `~/.claude/settings.json`에 이미 다른 훅(예: oh-my-claudecode 훅)이 등록된 상태
- **WHEN** `node install.mjs`를 실행하면
- **THEN** 기존 훅을 보존하면서 self-generation 훅을 추가 등록한다(SHALL). 기존 이벤트 배열에 push하는 방식으로 병합한다

#### Scenario: 중복 등록 방지

- **GIVEN** `settings.json`에 이미 `.self-generation` 경로를 포함하는 훅이 등록된 상태
- **WHEN** `node install.mjs`를 다시 실행하면
- **THEN** 해당 이벤트에 대해 중복 등록하지 않는다(SHALL). 판별 기준: hook group의 `hooks` 배열 중 하나라도 `command`에 `.self-generation` 문자열이 포함되면 이미 등록된 것으로 판단한다

---

### REQ-INF-006: 제거 모드 (--uninstall)

시스템은 `--uninstall` 플래그로 실행 시 `settings.json`에서 self-generation 훅만 선택적으로 제거해야 한다(SHALL).

#### Scenario: 훅 선택적 제거

- **GIVEN** `settings.json`에 self-generation 훅과 다른 훅이 함께 등록된 상태
- **WHEN** `node install.mjs --uninstall`을 실행하면
- **THEN** 각 이벤트의 hook group 배열에서 `command`에 `.self-generation`이 포함된 그룹만 `filter()`로 제거한다(SHALL). 다른 훅은 보존된다(SHALL). 필터링 후 빈 배열이 되면 해당 이벤트 키를 삭제한다(SHALL)

#### Scenario: settings.json 미존재

- **GIVEN** `~/.claude/settings.json`이 존재하지 않는 상태
- **WHEN** `node install.mjs --uninstall`을 실행하면
- **THEN** 에러 없이 "훅이 제거되었습니다" 메시지를 출력하고 종료한다(SHALL)

#### Scenario: 데이터 디렉토리 보존

- **GIVEN** `--uninstall` 플래그만 지정된 상태 (`--purge` 없음)
- **WHEN** `node install.mjs --uninstall`을 실행하면
- **THEN** `~/.self-generation/` 디렉토리와 데이터는 삭제하지 않는다(SHALL). 데이터 삭제 안내 메시지만 출력한다: `rm -rf ~/.self-generation`

---

### REQ-INF-007: 완전 제거 모드 (--uninstall --purge) — 스펙 확장 제안

> **주의**: 이 요구사항은 DESIGN.md 6.1.2절에 포함되어 있지 않은 스펙 확장 제안이다. 현재 DESIGN.md의 `--uninstall`은 훅 해제만 수행하고 데이터 삭제 기능은 없다. 구현 시 DESIGN.md에 해당 기능을 추가한 후 구현하는 것을 권장한다(SHOULD).

시스템은 `--uninstall --purge` 플래그 조합으로 실행 시 훅 해제와 함께 데이터 디렉토리를 삭제할 수 있다(MAY).

#### Scenario: 훅 해제 + 데이터 삭제

- **GIVEN** `settings.json`에 self-generation 훅이 등록되고 `~/.self-generation/` 디렉토리에 데이터가 존재하는 상태
- **WHEN** `node install.mjs --uninstall --purge`를 실행하면
- **THEN** REQ-INF-006의 훅 해제를 수행한 후, `~/.self-generation/` 디렉토리 전체를 `rmSync({ recursive: true, force: true })`로 삭제한다(MAY). 임베딩 데몬 소켓 파일(`/tmp/self-gen-embed.sock`)이 존재하면 `unlinkSync()`로 삭제한다(MAY)

#### Scenario: purge 단독 사용 불가

- **GIVEN** `--purge` 플래그만 지정되고 `--uninstall`이 없는 상태
- **WHEN** `node install.mjs --purge`를 실행하면
- **THEN** `--purge`는 `--uninstall`과 함께 사용해야 한다는 안내 메시지를 출력하고 정상 설치 프로세스를 실행한다(SHOULD)

---

## 비기능 요구사항

### 멱등성

- 설치 스크립트는 반복 실행해도 동일한 최종 상태를 보장해야 한다(SHALL)
- 이미 존재하는 파일(`package.json`, `config.json`)은 덮어쓰지 않는다(SHALL)
- 이미 등록된 훅은 중복 등록하지 않는다(SHALL)

### 에러 복구

- `npm install` 실패 시 명확한 에러 메시지와 함께 exit 1로 종료해야 한다(SHALL)
- 부분 실패 후 재실행으로 완전한 설치가 가능해야 한다(SHOULD)

### 사용자 피드백

- 각 단계의 진행 상황을 콘솔에 출력해야 한다(SHALL)
- 설치 완료/제거 완료 시 명확한 요약 메시지를 출력해야 한다(SHALL)

---

## 제약사항

- Node.js 내장 모듈(`fs`, `path`, `child_process`, `os`)만 사용해야 한다(SHALL) — 설치 전이므로 외부 패키지 사용 불가
- ES Modules 형식 (`.mjs` 확장자)
- `settings.json` 수정 시 전체 파일을 읽고 수정 후 다시 쓰는 방식(read-modify-write)을 사용한다(SHALL)
- `settings.json`은 JSON 형식으로 포매팅한다(SHALL): `JSON.stringify(settings, null, 2)`

---

## 용어 정의

| 용어 | 정의 |
|------|------|
| SELF_GEN_DIR | `~/.self-generation/` — 시스템 루트 디렉토리 |
| SETTINGS_PATH | `~/.claude/settings.json` — Claude Code 전역 설정 파일 |
| hook group | `settings.json`의 이벤트 배열 내 `{ hooks: [...], matcher?: string }` 객체 |
| 멱등성 | 동일 연산을 여러 번 실행해도 결과가 같은 성질 |
| 훅 등록 | `settings.json`에 이벤트-스크립트 매핑을 추가하는 과정 |
| 훅 해제 | `settings.json`에서 self-generation 관련 훅 매핑을 제거하는 과정 |
