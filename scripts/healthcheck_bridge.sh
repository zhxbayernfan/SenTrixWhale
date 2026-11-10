#!/bin/bash
# 健康检查：每5分钟检查bridge和llama-server

cd /home/sscy/lingbot-map/005SenTrixWhale

# 检查llama-server
if ! pgrep -f "llama-server" > /dev/null; then
    echo "$(date): llama-server未运行，重启..." >> state/bridge.log
    nohup /home/sscy/llama.cpp-new/build/bin/llama-server \
        -m /home/sscy/VLM/qwen3.5/weights/gguf/qwen35-lora-Q4_K_M.gguf \
        --mmproj /home/sscy/VLM/qwen3.5/weights/gguf/qwen35-lora-mmproj-f16.gguf \
        --alias qwen35-4b-lora-q4km \
        --host 0.0.0.0 --port 8100 \
        --ctx-size 24576 --parallel 1 --n-gpu-layers 999 \
        --threads 8 --reasoning off --flash-attn on \
        > /tmp/llama-server.log 2>&1 &
    sleep 10
fi

# 检查bridge
if ! pgrep -f "node bridge" > /dev/null; then
    echo "$(date): bridge未运行，重启..." >> state/bridge.log
    nohup node bridge/src/bridge.js >> state/bridge.log 2>&1 &
fi

# 验证连接
if curl -s --connect-timeout 3 http://127.0.0.1:8100/v1/models > /dev/null 2>&1; then
    echo "$(date): ✅ 所有服务正常" >> state/bridge.log
else
    echo "$(date): ❌ llama-server未就绪" >> state/bridge.log
fi
