#!/usr/bin/env bash
# =============================================================
# 全球基金查询 · 一键部署到 GitHub Pages
# 用法:
#   ./scripts/deploy.sh <github_token>                    # 自动识别用户名, 仓库名 global-fund-portal
#   ./scripts/deploy.sh <github_token> <用户名> [仓库名]
# Token 权限: classic PAT 勾选 repo 即可
#   https://github.com/settings/tokens/new?scopes=repo&description=global-fund-portal
# =============================================================
set -euo pipefail
TOKEN="${1:?用法: ./scripts/deploy.sh <github_token> [用户名] [仓库名]}"
API="https://api.github.com"
AUTH="Authorization: Bearer ${TOKEN}"
REPO="${3:-global-fund-portal}"

if [ -z "${2:-}" ]; then
  USER_NAME=$(curl -sf -H "$AUTH" "$API/user" | python3 -c "import sys,json;print(json.load(sys.stdin)['login'])")
else
  USER_NAME="$2"
fi
echo "==> 账号: ${USER_NAME}  仓库: ${REPO}"

CODE=$(curl -s -o /tmp/_repo.json -w "%{http_code}" -X POST -H "$AUTH" "$API/user/repos" \
  -d "{\"name\":\"${REPO}\",\"private\":false,\"has_wiki\":false,\"description\":\"全球基金查询 · 非A股基金数据门户\"}" || true)
if [ "$CODE" = "201" ]; then
  echo "==> 仓库已创建"
elif [ "$CODE" = "422" ]; then
  echo "==> 仓库已存在，跳过创建"
else
  echo "==> 创建仓库返回 ${CODE}: $(cat /tmp/_repo.json | head -c 300)"; exit 1
fi

cd "$(dirname "$0")/.."
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://x-access-token:${TOKEN}@github.com/${USER_NAME}/${REPO}.git"
else
  git remote add origin "https://x-access-token:${TOKEN}@github.com/${USER_NAME}/${REPO}.git"
fi
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push -u origin "$BRANCH"
echo "==> 代码已推送"

HTTP=$(curl -s -o /tmp/_pages.json -w "%{http_code}" -X POST -H "$AUTH" \
  "$API/repos/${USER_NAME}/${REPO}/pages" -d '{"source":{"branch":"'"$BRANCH"'","path":"/"}}' || true)
if [ "$HTTP" = "201" ] || [ "$HTTP" = "204" ]; then
  echo "==> GitHub Pages 已开启"
elif [ "$HTTP" = "409" ]; then
  echo "==> Pages 已存在"
else
  echo "==> Pages 开启返回 ${HTTP}（可到 Settings→Pages 手动选择 ${BRANCH} /root）: $(cat /tmp/_pages.json | head -c 200)"
fi

echo ""
echo "✅ 完成！首次构建约 1-3 分钟，访问地址:"
echo "   https://${USER_NAME}.github.io/${REPO}/"
echo "   仓库: https://github.com/${USER_NAME}/${REPO}"
