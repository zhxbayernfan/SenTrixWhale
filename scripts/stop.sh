#!/bin/bash
# scripts/stop.sh — SenTrixWhale 安全停止(261102)
# 职责: 按逆序停止服务(Bridge → NapCat), 保留SHW(共享服务)

set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🐳 SenTrixWhale 停止中..."

# 1. 停止Bridge
BRIDGE_PID=$(pgrep -f "005SenTrixWhale/bridge" 2>/dev/null || true)
if [ -n "$BRIDGE_PID" ]; then
    echo "⏹️  停止 Bridge (PID: $BRIDGE_PID)..."
    kill "$BRIDGE_PID" 2>/dev/null || true
    sleep 1
    if kill -0 "$BRIDGE_PID" 2>/dev/null; then
        echo "   强制停止..."
        kill -9 "$BRIDGE_PID" 2>/dev/null || true
    fi
    echo "✅ Bridge 已停止"
else
    echo "⚪ Bridge 未运行"
fi

# 2. 停止Demo服务
DEMO_PID=$(pgrep -f "005SenTrixWhale/demo" 2>/dev/null || true)
if [ -n "$DEMO_PID" ]; then
    echo "⏹️  停止 Demo (PID: $DEMO_PID)..."
    kill "$DEMO_PID" 2>/dev/null || true
    sleep 1
    echo "✅ Demo 已停止"
else
    echo "⚪ Demo 未运行"
fi

# 3. NapCat(可选停止, 默认保留)
if [ "$1" = "--stop-napcat" ]; then
    if docker ps --format '{{.Names}}' | grep -q "^napcat3$"; then
        echo "⏹️  停止 NapCat3..."
        docker stop napcat3 >/dev/null 2>&1
        echo "✅ NapCat3 已停止"
    else
        echo "⚪ NapCat3 未运行"
    fi
else
    if docker ps --format '{{.Names}}' | grep -q "^napcat3$"; then
        echo "ℹ️  NapCat3 保留运行(--stop-napcat 可停止)"
    fi
fi

# 4. SHW(共享服务, 不停止)
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9598/api/health 2>/dev/null | grep -q "200"; then
    echo "ℹ️  SHW 2.0 API (9598) 保留运行(共享服务)"
fi

echo ""
echo "🎉 SenTrixWhale 停止完成!"
