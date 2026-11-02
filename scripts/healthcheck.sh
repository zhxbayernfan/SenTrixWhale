#!/bin/bash
# scripts/healthcheck.sh — SenTrixWhale 健康检查(261102)
# 职责: 检查所有服务状态, 输出摘要+详细状态码
# 用法: ./healthcheck.sh [-v]  (-v 输出详细诊断信息)

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERBOSE=0
[ "$1" = "-v" ] && VERBOSE=1

PASS=0
FAIL=0
WARN=0

check() {
    local name="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        echo "✅ $name"
        PASS=$((PASS + 1))
    else
        if [ "$VERBOSE" -eq 1 ]; then
            echo "❌ $name"
            echo "   诊断: $(eval "$cmd" 2>&1 | tail -1)"
        else
            echo "❌ $name"
        fi
        FAIL=$((FAIL + 1))
    fi
}

warn_check() {
    local name="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        echo "✅ $name"
        PASS=$((PASS + 1))
    else
        echo "⚠️  $name (非关键)"
        WARN=$((WARN + 1))
    fi
}

echo "=== 🐳 SenTrixWhale 健康检查 ==="
echo ""

# 关键服务
check "SHW 2.0 API (9598)" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9598/api/health | grep -q '200'"
check "NapCat3 WS (3001)" "curl -s http://127.0.0.1:3001/ | grep -q 'ok'"
check "Bridge (进程)" "pgrep -f '005SenTrixWhale/bridge'"
check "Demo (7738)" "curl -s http://127.0.0.1:7738/ | grep -q '<form'"

# 辅助检查
warn_check "SHW Embedding (8101)" "curl -s http://127.0.0.1:8101/health | grep -q 'ok'"
warn_check "SHW CLIP (8103)" "curl -s http://127.0.0.1:8103/health | grep -q 'ok'"
warn_check "llama-server (8100)" "curl -s http://127.0.0.1:8100/health | grep -q 'ok'"
warn_check "NapCat Docker" "docker ps --format '{{.Names}}' | grep -q '^napcat3$'"
warn_check "Disk空间" "[ $(df -h / | awk 'NR==2{gsub(/%/,\"\",$5); print $5}') -lt 90 ]"

echo ""
echo "=== 汇总 ==="
echo "✅ 通过: $PASS  ❌ 失败: $FAIL  ⚠️  警告: $WARN"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "❌ 存在失败服务, 请运行: $BASE_DIR/scripts/start.sh"
    exit 1
fi

exit 0
