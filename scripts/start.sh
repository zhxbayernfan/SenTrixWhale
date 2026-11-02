#!/bin/bash
# scripts/start.sh — SenTrixWhale 一键启动(261102)
# 职责: 检查依赖 → 启动SHW(如未起) → 启动NapCat → 启动Bridge → 健康检查

set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE_DIR/logs"
mkdir -p "$LOG_DIR"

echo "🐳 SenTrixWhale 启动中..."

# 1. 检查Node版本
NODE_VER=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 22 ]; then
    echo "❌ Node.js >= 22  required, found $NODE_VER"
    exit 1
fi
echo "✅ Node.js $NODE_VER"

# 2. 检查SHW 2.0(9598)
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9598/api/health | grep -q "200"; then
    echo "✅ SHW 2.0 API (9598) 运行中"
else
    echo "⚠️  SHW 2.0 API 未启动, 请手动: cd 004SHW/sentrix-home-web-2.0 && make dev"
fi

# 3. 启动NapCat3(5号QQ)
if docker ps --format '{{.Names}}' | grep -q "^napcat3$"; then
    echo "✅ NapCat3 运行中"
else
    echo "🔄 启动 NapCat3..."
    docker start napcat3 >/dev/null 2>&1
    sleep 3
fi

# 4. 启动Bridge(工程鲸)
if pgrep -f "005SenTrixWhale/bridge" >/dev/null; then
    echo "✅ Bridge 运行中"
else
    echo "🔄 启动 Bridge..."
    cd "$BASE_DIR/bridge"
    WHALE_HOME="$BASE_DIR/bridge" nohup node src/bridge.js >> "$LOG_DIR/bridge.log" 2>&1 &
    sleep 2
fi

# 5. 健康检查
echo ""
echo "=== 健康检查 ==="
echo -n "NapCat WS: "; curl -s http://127.0.0.1:3001/ >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "SHW API:   "; curl -s http://127.0.0.1:9598/api/health >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "Demo:      "; curl -s http://127.0.0.1:7738/ >/dev/null 2>&1 && echo "✅" || echo "❌"
echo ""
echo "🎉 SenTrixWhale 启动完成!"
echo "   演示地址: http://192.168.0.224:7738"
echo "   日志目录: $LOG_DIR"
