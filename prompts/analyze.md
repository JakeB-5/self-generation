<!-- ~/.self-generation/prompts/analyze.md -->

아래는 Claude Code 사용자의 최근 {{days}}일간 사용 로그이다.
프로젝트: {{project}} (전역 분석 시 "all")

## 로그 데이터

{{log_data}}

## 피드백 이력

{{feedback_history}}

## 기존 스킬 목록

{{existing_skills}}

## 제안 효과 메트릭

{{outcome_metrics}}

## 분석 지시

위 로그를 분석하여 다음을 JSON으로 출력하라:

1. **반복 프롬프트 클러스터**: 의미적으로 유사한 프롬프트를 그룹핑하라.
   - 표면적 키워드가 달라도 의도가 같으면 같은 클러스터로 묶어라.
   - 예: "TS 초기화", "타입스크립트 셋업", "새 TS 프로젝트" → 같은 클러스터

2. **반복 도구 시퀀스**: 여러 세션에서 반복되는 의미 있는 도구 패턴을 감지하라.
   - Read→Edit 같은 기본 패턴은 제외하라.
   - "Grep → Read → Edit → Bash(test)" 같은 목적이 있는 워크플로우만 포함하라.

3. **반복 에러 패턴**: 동일/유사 에러가 반복되면 방지 규칙을 도출하라.
   - 에러 메시지의 정규화된 형태와 원본을 모두 고려하라.
   - 규칙은 CLAUDE.md에 추가할 수 있는 자연어 지침으로 작성하라.

4. **개선 제안**: 각 패턴에 대해 아래 3가지 유형 중 적합한 제안을 생성하라:
   - `skill`: 커스텀 스킬 생성 (반복 작업 자동화)
   - `claude_md`: CLAUDE.md 지침 추가 (반복 지시 영구화)
   - `hook`: 훅 워크플로우 등록 (반복 도구 패턴 자동화)

5. **스킬 설명 및 키워드**: 각 기존 스킬에 대해, 스킬의 목적을 한 줄로 설명하고
   관련 키워드를 추출하라. (벡터 임베딩 생성에 사용됨)
   - 예: "ts-init" → { description: "TypeScript 프로젝트 초기화 및 린터 설정", keywords: ["typescript", "초기화", "eslint", "prettier", "setup"] }

## 제안 품질 기준 (v7)

우선순위:
- 빈도(3회 이상 반복) × 복잡도(프롬프트 길이 또는 도구 수) = 절감 잠재력
- 빈도 2회 이하의 패턴은 제안하지 마라
- 기존 스킬 목록(`existing_skills`)과 중복되는 제안은 하지 마라
- 제안 효과 메트릭에서 사용률이 낮은 유형의 제안은 줄여라

제안하지 말아야 할 것:
- "코드를 더 잘 작성하세요" 같은 일반적 조언
- Read → Edit 같은 기본 도구 패턴
- 1회만 발생한 에러에 대한 규칙

## 출력 형식 (JSON)

```json
{
  "clusters": [
    {
      "id": "cluster-0",
      "summary": "클러스터 요약",
      "intent": "setup|feature-add|bug-fix|refactor|query|...",
      "count": 5,
      "examples": ["프롬프트 원문1", "프롬프트 원문2"],
      "firstSeen": "ISO8601",
      "lastSeen": "ISO8601"
    }
  ],
  "workflows": [
    {
      "pattern": "Grep → Read → Edit → Bash(test)",
      "count": 4,
      "purpose": "코드 검색 후 수정 및 테스트",
      "sessions": 10
    }
  ],
  "errorPatterns": [
    {
      "pattern": "정규화된 에러",
      "count": 3,
      "tools": ["Bash"],
      "proposedRule": "CLAUDE.md에 추가할 규칙"
    }
  ],
  "suggestions": [
    {
      "type": "skill|claude_md|hook",
      "id": "suggest-0",
      "summary": "제안 요약",
      "evidence": "근거 설명",
      "action": "구체적 적용 방법",
      "priority": 1,
      "skillName": "ts-init (skill 유형만)",
      "rule": "규칙 텍스트 (claude_md 유형만)"
    }
  ],
  "skill_descriptions": {
    "skill-name": {
      "description": "스킬 목적 한 줄 설명",
      "keywords": ["keyword1", "keyword2", "키워드3"]
    }
  }
}
```

JSON만 출력하라. 다른 텍스트는 포함하지 마라.
