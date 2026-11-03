#!/bin/bash
# monitoring/healthcheck.sh — SenTrixWhale 健康检查
# 用法: ./healthcheck.sh
# 输出: JSON格式健康状态

LLAMA_PORT=8100
NAPCAT_WS=3001
NAPCAT_HTTP=3000
BRIDGE_LOG="state/bridge.log"

errors=()

# 检查llama-server
if curl -sf "http://127.0.0.1:${LLAMA_PORT}/health" > /dev/null 2>&1; then
    llama="ok"
else
    llama="down"
    errors+=("llama-server:${LLAMA_PORT}不可达")
fi

# 检查bridge日志最近活动
if [ -f "$BRIDGE_LOG" ]; then
    last_log=$(tail -1 "$BRIDGE_LOG" | cut -d' ' -f1-2)
    bridge="ok"
else
    bridge="no_log"
    errors+=("bridge日志不存在")
fi

# 检查NapCat WS
if nc -z -w2 127.0.0.1 $NAPCAT_WS 2>/dev/null; then
    napcat_ws="ok"
else
    napcat_ws="down"
    errors+=("NapCat WS:${NAPCAT_WS}不可达")
fi

# 检查磁盘空间
disk_pct=$(df -BG /Users/test 2>/dev/null | tail -1 | awk '{print $4}' | tr -d '%')
if [ -n "$disk_pct" ] && [ "$disk_pct" -lt 10 ] 2>/dev/null; then
    disk="warning"
    errors+=("磁盘剩余不足10%")
else
    disk="ok"
fi

# 输出
status="healthy"
[ ${#errors[@]} -gt 0 ] && status="degraded"
echo "{\"status\":\"${status}\",\"llama\":\"${llama}\",\"bridge\":\"${bridge}\",\"napcat_ws\":\"${napcat_ws}\",\"disk\":\"${disk}\",\"errors\":[\"$(IFS='","'; echo "${errors[*]}")\"],\"last_check\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"

exit ${#errors[@]}
