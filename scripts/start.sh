#!/bin/bash
# scripts/start.sh — SenTrixWhale 一键启动(261103)
# 路径配置: .env.deploy

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/scripts/load_env.sh"

set -e
LOG_DIR="${SENTRIXWHALE_ROOT}/logs"
mkdir -p "$LOG_DIR"

echo "🐳 SenTrixWhale 启动中..."

# 1. SHW 2.0
if curl -s "${SHW_API_URL}/api/health" >/dev/null 2>&1; then
    echo "✅ SHW 2.0 API (${SHW_API_PORT}) 运行中"
else
    echo "⚠️  SHW 2.0 API 未启动"
fi

# 2. NapCat
if docker ps --format '{{.Names}}' | grep -q "^napcat3$"; then
    echo "✅ NapCat3 运行中"
else
    docker start napcat3 >/dev/null 2>&1
    sleep 3
fi

# 3. Bridge
if pgrep -f "005SenTrixWhale/bridge" >/dev/null; then
    echo "✅ Bridge 运行中"
else
    cd "${SENTRIXWHALE_ROOT}/bridge"
    WHALE_HOME="${SENTRIXWHALE_ROOT}/bridge" nohup node src/bridge.js >> "$LOG_DIR/bridge.log" 2>&1 &
    sleep 2
fi

# 4. 健康检查
echo ""
echo "=== 健康检查 ==="
echo -n "NapCat WS: "; curl -s "http://127.0.0.1:${NAPCAT_PORT_WS}/" >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "SHW API:   "; curl -s "${SHW_API_URL}/api/health" >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "Demo:      "; curl -s "http://127.0.0.1:${DEMO_PORT}/" >/dev/null 2>&1 && echo "✅" || echo "❌"
echo ""
echo "🎉 SenTrixWhale 启动完成!"
echo "   演示地址: http://192.168.0.224:${DEMO_PORT}"
echo "   日志目录: $LOG_DIR"
