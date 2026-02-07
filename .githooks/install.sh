#!/bin/sh
# Git hooks 설치 스크립트
# 사용법: sh .githooks/install.sh

HOOK_DIR=".git/hooks"
SOURCE_DIR=".githooks"

echo "Git hooks 설치 중..."

for hook in pre-commit pre-push commit-msg; do
  if [ -f "$SOURCE_DIR/$hook" ]; then
    cp "$SOURCE_DIR/$hook" "$HOOK_DIR/$hook"
    chmod +x "$HOOK_DIR/$hook"
    echo "  $hook 설치 완료"
  fi
done

echo "Git hooks 설치 완료!"
echo ""
echo "또는 git config로 직접 지정:"
echo "  git config core.hooksPath .githooks"
