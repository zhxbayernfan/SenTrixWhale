#!/bin/bash
# scripts/stop.sh — SenTrixWhale 安全停止(261103)

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/scripts/load_env.sh"

set -e
echo "🐳 SenTrixWhale 停止中..."

BRIDGE_PID=$(pgrep -f "005SenTrixWhale/bridge" 2>/dev/null || true)
if [ -n "$BRIDGE_PID" ]; then
    kill "$BRIDGE_PID" 2>/dev/null || true; sleep 1
    kill -0 "$BRIDGE_PID" 2>/dev/null && kill -9 "$BRIDGE_PID" 2>/dev/null || true
    echo "✅ Bridge 已停止"
fi

DEMO_PID=$(pgrep -f "005SenTrixWhale/demo" 2>/dev/null || true)
if [ -n "$DEMO_PID" ]; then
    kill "$DEMO_PID" 2>/dev/null || true
    echo "✅ Demo 已停止"
fi

if [ "$1" = "--stop-napcat" ]; then
    docker stop napcat3 >/dev/null 2>&1 && echo "✅ NapCat3 已停止"
fi

echo "🎉 SenTrixWhale 停止完成!"
