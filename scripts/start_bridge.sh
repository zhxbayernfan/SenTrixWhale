#!/bin/bash
cd /home/sscy/lingbot-map/005SenTrixWhale

# 检查llama-server
if ! pgrep -f "llama-server" > /dev/null; then
    echo "启动llama-server..."
    nohup /home/sscy/llama.cpp-new/build/bin/llama-server \
        -m /home/sscy/VLM/qwen3.5/weights/gguf/qwen35-lora-Q4_K_M.gguf \
        --mmproj /home/sscy/VLM/qwen3.5/weights/gguf/qwen35-lora-mmproj-f16.gguf \
        --alias qwen35-4b-lora-q4km \
        --host 0.0.0.0 --port 8100 \
        --ctx-size 24576 --parallel 1 --n-gpu-layers 999 \
        --threads 8 --reasoning off --flash-attn on \
        --cache-type-k q8_0 --cache-type-v q8_0 \
        --metrics --slot-prompt-similarity 0 --ctx-checkpoints 1 --cache-ram 512 \
        > /tmp/llama-server.log 2>&1 &
    sleep 10
fi

# 检查llama-server是否就绪
for i in {1..10}; do
    if curl -s --connect-timeout 2 http://127.0.0.1:8100/v1/models > /dev/null 2>&1; then
        echo "✅ llama-server就绪"
        break
    fi
    echo "等待llama-server启动... ($i/10)"
    sleep 3
done

# 启动bridge
echo "启动bridge..."
pkill -f "node bridge" 2>/dev/null
sleep 2
nohup node bridge/src/bridge.js >> state/bridge.log 2>&1 &
echo "Bridge PID: $!"

# 验证bridge
sleep 5
if pgrep -f "node bridge" > /dev/null; then
    echo "✅ bridge启动成功"
else
    echo "❌ bridge启动失败，检查日志："
    tail -20 state/bridge.log
fi
