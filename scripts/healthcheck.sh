#!/bin/bash
# scripts/healthcheck.sh — SenTrixWhale 健康检查(261103)

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/scripts/load_env.sh"

PASS=0; FAIL=0; WARN=0

check() { [ "$1" ] && echo "✅ $2" && PASS=$((PASS+1)) || { echo "❌ $2"; FAIL=$((FAIL+1)); }; }
warn_check() { [ "$1" ] && echo "✅ $2" && PASS=$((PASS+1)) || { echo "⚠️  $2 (非关键)"; WARN=$((WARN+1)); }; }

echo "=== 🐳 SenTrixWhale 健康检查 ==="
echo ""

check "curl -s ${SHW_API_URL}/api/health >/dev/null 2>&1" "SHW 2.0 API (${SHW_API_PORT})"
check "curl -s http://127.0.0.1:${NAPCAT_PORT_WS}/ >/dev/null 2>&1" "NapCat WS (${NAPCAT_PORT_WS})"
check "pgrep -f '005SenTrixWhale/bridge'" "Bridge (进程)"
check "curl -s http://127.0.0.1:${DEMO_PORT}/ >/dev/null 2>&1" "Demo (${DEMO_PORT})"

warn_check "curl -s http://127.0.0.1:8101/health >/dev/null 2>&1" "SHW Embedding (8101)"
warn_check "curl -s http://127.0.0.1:8103/health >/dev/null 2>&1" "SHW CLIP (8103)"
warn_check "pgrep -f 'llama-server'" "llama-server (8100)"
warn_check "docker ps --format '{{.Names}}' | grep -q '^napcat3$'" "NapCat Docker"
warn_check "[ $(df -h / | awk 'NR==2{gsub(/%/,\"\",\$5); print \$5}') -lt 90 ]" "Disk空间"

echo ""
echo "=== 汇总 ==="
echo "✅ 通过: $PASS  ❌ 失败: $FAIL  ⚠️  警告: $WARN"

[ "$FAIL" -gt 0 ] && exit 1
