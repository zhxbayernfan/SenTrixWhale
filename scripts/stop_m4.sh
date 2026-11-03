#!/bin/bash
# scripts/stop_m4.sh — SenTrixWhale Mac M4优雅停止(261103)

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/scripts/load_env.sh"

set -e
LOG_DIR="${SENTRIXWHALE_ROOT}/logs"

echo "🐳 SenTrixWhale M4 停止中..."

# 保存状态
if [ -f "$DIR/bridge/state/daily.json" ]; then
    cp "$DIR/bridge/state/daily.json" "$DIR/bridge/state/daily.json.bak.$(date +%Y%m%d)"
    echo "✅ 状态已备份"
fi

# 停止Bridge
BRIDGE_PID=$(pgrep -f "005SenTrixWhale/bridge" 2>/dev/null || true)
if [ -n "$BRIDGE_PID" ]; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    sleep 1
    kill -0 "$BRIDGE_PID" 2>/dev/null && kill -9 "$BRIDGE_PID" 2>/dev/null || true
    echo "✅ Bridge 已停止"
fi

# 停止Demo
DEMO_PID=$(pgrep -f "005SenTrixWhale/demo" 2>/dev/null || true)
if [ -n "$DEMO_PID" ]; then
    kill "$DEMO_PID" 2>/dev/null || true
    echo "✅ Demo 已停止"
fi

# llama-server(默认保留)
if [ "$1" = "--stop-llama" ]; then
    LLAMA_PID=$(pgrep -f "llama-server.*${LLAMA_PORT}" 2>/dev/null || true)
    [ -n "$LLAMA_PID" ] && kill "$LLAMA_PID" 2>/dev/null && echo "✅ llama-server 已停止"
else
    pgrep -f "llama-server.*${LLAMA_PORT}" >/dev/null 2>/dev/null && echo "ℹ️  llama-server 保留运行"
fi

echo "🎉 SenTrixWhale M4 停止完成!"
