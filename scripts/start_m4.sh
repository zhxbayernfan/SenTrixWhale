#!/bin/bash
# scripts/start_m4.sh — SenTrixWhale Mac M4一键启动(261103)
# 目标机器: 192.168.0.37 (MacMini-zhx, Apple Silicon M4)
# 职责: 启动llama-server(Metal) + bridge + napcat(Mac版)
# 用法: ./start_m4.sh  [在0.37上执行]

set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE_DIR/logs"
mkdir -p "$LOG_DIR"

echo "🐳 SenTrixWhale M4 启动中..."

# 1. 检查llama-server(Metal)
if pgrep -f "llama-server.*8100" >/dev/null; then
    echo "✅ llama-server (8100) 运行中"
else
    echo "🔄 启动 llama-server (Metal)..."
    nohup llama-server \
        -m /home/sscy/models/qwen35-lora-Q4_K_M.gguf \
        --mmproj /home/sscy/models/qwen35-lora-mmproj-f16.gguf \
        --host 127.0.0.1 --port 8100 \
        --ctx-size 32768 --parallel 4 \
        --cache-type-k q8_0 \
        --metadata-overwrite '{"general.architecture":"qwen3"}' \
        >> "$LOG_DIR/llama-server.log" 2>&1 &
    sleep 5
    # 等待模型加载
    for i in $(seq 1 30); do
        if curl -s http://127.0.0.1:8100/health >/dev/null 2>&1; then
            echo "✅ llama-server 就绪"
            break
        fi
        if [ "$i" -eq 30 ]; then
            echo "❌ llama-server 30s内未就绪, 请检查 $LOG_DIR/llama-server.log"
            exit 1
        fi
        sleep 1
    done
fi

# 2. 检查SHW 2.0 (9598)
if curl -s http://127.0.0.1:9598/api/health >/dev/null 2>&1; then
    echo "✅ SHW 2.0 API (9598) 运行中"
else
    echo "⚠️  SHW 2.0 API 未启动, 请手动: cd 004SHW/sentrix-home-web-2.0 && make dev"
fi

# 3. 检查NapCat (Mac版, 3001)
if curl -s http://127.0.0.1:3001/ >/dev/null 2>&1; then
    echo "✅ NapCat (3001) 运行中"
else
    echo "⚠️  NapCat 未启动, 请手动启动Mac版NapCat"
fi

# 4. 启动Bridge
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
echo "=== M4 健康检查 ==="
echo -n "llama (8100): "; curl -s http://127.0.0.1:8100/health >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "SHW (9598):   "; curl -s http://127.0.0.1:9598/api/health >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "NapCat (3001):"; curl -s http://127.0.0.1:3001/ >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "Demo (7738):  "; curl -s http://127.0.0.1:7738/ >/dev/null 2>&1 && echo "✅" || echo "❌"
echo ""
echo "🎉 SenTrixWhale M4 启动完成!"
echo "   演示地址: http://192.168.0.37:7738"
echo "   日志目录: $LOG_DIR"
