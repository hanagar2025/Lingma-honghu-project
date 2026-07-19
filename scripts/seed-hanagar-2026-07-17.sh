#!/usr/bin/env bash
# 将 2026-07-17 15:30 账户快照同步到本地 TIOS（hanagar 账户）
# 用法：
#   cd "/Users/muscap/投资助理"
#   bash scripts/seed-hanagar-2026-07-17.sh
# 可选环境变量：API_BASE（默认 http://localhost:5001/api）、PASSWORD（默认 test123456）

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5001/api}"
USER_NAME="${USER_NAME:-hanagar}"
EMAIL="${EMAIL:-hanagar@163.com}"
PASSWORD="${PASSWORD:-test123456}"

# 账户：总资产384.1万，仓位63.4% → 持仓市值合计243.4万，现金140.7万
# 净值高点按体系日志估算430万（精确值待券商App回填后改）
CASH=1407000
PEAK_ASSETS=4300000
SNAPSHOT_DATE="2026-07-17"

echo "==> API: $API_BASE"
echo "==> 用户: $USER_NAME"

# 登录；失败则注册再登录
login() {
  curl -sS -X POST "$API_BASE/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_NAME\",\"password\":\"$PASSWORD\"}"
}

RESP="$(login || true)"
TOKEN="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print((d.get("data") or {}).get("token") or "")' "$RESP" 2>/dev/null || true)"

if [ -z "$TOKEN" ]; then
  echo "==> 登录失败，尝试注册..."
  curl -sS -X POST "$API_BASE/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$USER_NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" >/dev/null || true
  RESP="$(login)"
  TOKEN="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d["data"]["token"])' "$RESP")"
fi

echo "==> 登录成功"

AUTH="Authorization: Bearer $TOKEN"

# 清空旧持仓
echo "==> 清空旧持仓..."
IDS="$(curl -sS "$API_BASE/portfolio/positions" -H "$AUTH" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(p["id"] for p in (d.get("data") or d or [])))')"
for id in $IDS; do
  curl -sS -X DELETE "$API_BASE/portfolio/positions/$id" -H "$AUTH" >/dev/null
done

# 写入7只持仓（板块/主题供仓位闸门使用；成本价由 市值-盈亏 反推）
# 格式: code|name|qty|cost|price|category|sector|theme
POSITIONS=(
  "300308|中际旭创|400|967.50|979|mainline|通信|AI"
  "300502|新易盛|1260|470.63|482|mainline|通信|AI"
  "688041|海光信息|2500|310.00|304|mainline|电子|AI"
  "603986|兆易创新|200|580.00|463|mainline|电子|半导体"
  "688008|澜起科技|1300|260.77|183|mainline|电子|半导体"
  "688012|中微公司|400|382.50|350|mainline|电子|半导体"
  "002371|北方华创|300|806.67|677|mainline|电子|半导体"
)

echo "==> 写入持仓..."
for row in "${POSITIONS[@]}"; do
  IFS='|' read -r code name qty cost price category sector theme <<<"$row"
  curl -sS -X POST "$API_BASE/portfolio/positions" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"stockCode\":\"$code\",\"stockName\":\"$name\",\"quantity\":$qty,\"costPrice\":$cost,\"currentPrice\":$price,\"category\":\"$category\",\"sector\":\"$sector\",\"theme\":\"$theme\"}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("success"), d; print("  +", d["data"]["stockName"], d["data"]["stockCode"])'
done

# 澜起处于调查期：禁买
echo "==> 规则卡：澜起禁买..."
curl -sS -X PUT "$API_BASE/tios/rule-cards/688008" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"banBuy":true,"banReason":"调查期禁买（体系规则卡）"}' >/dev/null

echo "==> 账户状态：现金=${CASH} 峰值=${PEAK_ASSETS}（快照日 ${SNAPSHOT_DATE}）..."
curl -sS -X PUT "$API_BASE/tios/account" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"cash\":$CASH,\"peakAssets\":$PEAK_ASSETS}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("success"), d; print("  账户已更新")'

echo "==> 同步真实K线并生成盘前四问..."
curl -sS -X POST "$API_BASE/tios/run" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{}' \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d.get("success"), d
r=d["data"]["report"]
print("  报告日:", r["date"])
print("  阶段:", r["stage"]["confirmed"], "仓位上限", int(r["stage"]["positionCap"]*100), "%")
print("  回撤:", round(r["portfolioCircuit"]["drawdownPct"]*100,1), "%")
print("  结论:", r["conclusion"])
print("  卖出指令数:", len(r["sells"]))
for s in r["sells"]:
  print("   -", s["name"], s["clause"], s["action"])
'

echo ""
echo "完成。打开前端「盘前四问」查看。"
echo "提示：净值高点当前按430万估算；请在券商App核对历史最高净值后，在页面「账户状态」里改准。"
