#!/bin/bash
# scripts/stop_m4.sh — SenTrixWhale Mac M4优雅停止(261103)
# 职责: 保存状态 → 停止服务(逆序) → 清理进程

set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🐳 SenTrixWhale M4 停止中..."

# 1. 保存状态(bridge daily.json)
if [ -f "$BASE_DIR/bridge/state/daily.json" ]; then
    cp "$BASE_DIR/bridge/state/daily.json" "$BASE_DIR/bridge/state/daily.json.bak.$(date +%Y%m%d)"
    echo "✅ 状态已备份"
fi

# 2. 停止Bridge
BRIDGE_PID=$(pgrep -f "005SenTrixWhale/bridge" 2>/dev/null || true)
if [ -n "$BRIDGE_PID" ]; then
    echo "⏹️  停止 Bridge (PID: $BRIDGE_PID)..."
    kill "$BRIDGE_PID" 2>/dev/null || true
    sleep 1
    if kill -0 "$BRIDGE_PID" 2>/dev/null; then
        kill -9 "$BRIDGE_PID" 2>/dev/null || true
    fi
    echo "✅ Bridge 已停止"
else
    echo "⚪ Bridge 未运行"
fi

# 3. 停止Demo
DEMO_PID=$(pgrep -f "005SenTrixWhale/demo" 2>/dev/null || true)
if [ -n "$DEMO_PID" ]; then
    echo "⏹️  停止 Demo (PID: $DEMO_PID)..."
    kill "$DEMO_PID" 2>/dev/null || true
    echo "✅ Demo 已停止"
else
    echo "⚪ Demo 未运行"
fi

# 4. llama-server(可选保留)
if [ "$1" = "--stop-llama" ]; then
    LLAMA_PID=$(pgrep -f "llama-server.*8100" 2>/dev/null || true)
    if [ -n "$LLAMA_PID" ]; then
        echo "⏹️  停止 llama-server (PID: $LLAMA_PID)..."
        kill "$LLAMA_PID" 2>/dev/null || true
        sleep 1
        echo "✅ llama-server 已停止"
    fi
else
    if pgrep -f "llama-server.*8100" >/dev/null 2>/dev/null; then
        echo "ℹ️  llama-server (8100) 保留运行(--stop-llama可停止)"
    fi
fi

# 5. NapCat(可选停止)
if [ "$1" = "--stop-napcat" ]; then
    # Mac版NapCat进程名可能不同, 尝试查找
    NAPCAT_PID=$(pgrep -f "napcat" 2>/dev/null || true)
    if [ -n "$NAPCAT_PID" ]; then
        echo "⏹️  停止 NapCat (PID: $NAPCAT_PID)..."
        kill "$NAPCAT_PID" 2>/dev/null || true
        echo "✅ NapCat 已停止"
    else
        echo "⚪ NapCat 未运行"
    fi
else
    if pgrep -f "napcat" >/dev/null 2>/dev/null; then
        echo "ℹ️  NapCat 保留运行(--stop-napcat可停止)"
    fi
fi

echo ""
echo "🎉 SenTrixWhale M4 停止完成!"
