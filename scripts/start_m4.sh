#!/bin/bash
# scripts/start_m4.sh — SenTrixWhale Mac M4一键启动(261103)
# 目标机器: 0.37 (MacMini-zhx, Apple Silicon M4)
# 路径配置: .env.deploy (复制 .env.deploy.example 并修改)

DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/scripts/load_env.sh"

set -e
LOG_DIR="${SENTRIXWHALE_ROOT}/logs"
mkdir -p "$LOG_DIR"

echo "🐳 SenTrixWhale M4 启动中..."

# 1. llama-server(Metal)
if pgrep -f "llama-server.*${LLAMA_PORT}" >/dev/null; then
    echo "✅ llama-server (${LLAMA_PORT}) 运行中"
else
    echo "🔄 启动 llama-server (Metal)..."
    MODEL_PATH="${MODEL_DIR}/${LLAMA_MODEL}"
    MMPROJ_PATH="${MODEL_DIR}/${MM PROJ_MODEL}"
    nohup ${LLAMA_SERVER_BIN} \
        -m "$MODEL_PATH" \
        --mmproj "$MMPROJ_PATH" \
        --host 127.0.0.1 --port "${LLAMA_PORT}" \
        --ctx-size "${LLAMA_CTX_SIZE}" --parallel "${LLAMA_PARALLEL}" \
        --cache-type-k q8_0 \
        --metadata-overwrite '{"general.architecture":"qwen3"}' \
        >> "$LOG_DIR/llama-server.log" 2>&1 &
    # 等待模型加载(最多30s)
    for i in $(seq 1 30); do
        if curl -s "http://127.0.0.1:${LLAMA_PORT}/health" >/dev/null 2>&1; then
            echo "✅ llama-server 就绪"
            break
        fi
        [ "$i" -eq 30 ] && echo "❌ llama-server 30s内未就绪, 检查 $LOG_DIR/llama-server.log" && exit 1
        sleep 1
    done
fi

# 2. SHW 2.0
if curl -s "${SHW_API_URL}/api/health" >/dev/null 2>&1; then
    echo "✅ SHW 2.0 API (${SHW_API_PORT}) 运行中"
else
    echo "⚠️  SHW 2.0 API 未启动"
fi

# 3. NapCat (Mac版)
if curl -s "http://127.0.0.1:${NAPCAT_PORT_WS}/" >/dev/null 2>&1; then
    echo "✅ NapCat (${NAPCAT_PORT_WS}) 运行中"
else
    echo "⚠️  NapCat 未启动, 请手动启动Mac版NapCat"
fi

# 4. Bridge
if pgrep -f "005SenTrixWhale/bridge" >/dev/null; then
    echo "✅ Bridge 运行中"
else
    echo "🔄 启动 Bridge..."
    cd "${SENTRIXWHALE_ROOT}/bridge"
    WHALE_HOME="${SENTRIXWHALE_ROOT}/bridge" nohup node src/bridge.js >> "$LOG_DIR/bridge.log" 2>&1 &
    sleep 2
fi

# 5. 健康检查
echo ""
echo "=== M4 健康检查 ==="
echo -n "llama (${LLAMA_PORT}):    "; curl -s "http://127.0.0.1:${LLAMA_PORT}/health" >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "SHW (${SHW_API_PORT}):    "; curl -s "${SHW_API_URL}/api/health" >/dev/null 2>&1 && echo "✅" || echo "❌"
echo -n "NapCat (${NAPCAT_PORT_WS}):"; curl -s "http://127.0.0.1:${NAPCAT_PORT_WS}/" >/dev/null 2>&1 && echo "✅" || echo "❌"
echo ""
echo "🎉 SenTrixWhale M4 启动完成!"
echo "   演示地址: http://192.168.0.37:${DEMO_PORT}"
echo "   日志目录: $LOG_DIR"
