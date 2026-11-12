#!/bin/bash
# scripts/bridge_daemon.sh — 工程鲸 bridge 常驻守护
#
# 解决的三个问题：
#   1. bridge 卡死/退出后没人拉起（昨天 10:45–10:53 断了 8 分钟，期间消息无人处理）
#   2. macOS 对长时间无交互的后台进程降频，用 caffeinate -i 顶住
#   3. 日志无限增长，超过 20MB 自动切一份
#
# 用法：
#   bash scripts/bridge_daemon.sh          # 前台守护（Ctrl-C 退出）
#   nohup bash scripts/bridge_daemon.sh &  # 后台常驻
set -u

PROJ="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJ"
NODE="${NODE:-node}"
LOG="$PROJ/state/bridge.log"
OUT="$PROJ/logs/bridge.out"
CHECK_SEC="${CHECK_SEC:-20}"

mkdir -p "$PROJ/logs"

say() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }

running() {
    pgrep -f "$NODE .*bridge/src/bridge\.js" >/dev/null 2>&1
}

start() {
    nohup caffeinate -i "$NODE" bridge/src/bridge.js >> "$OUT" 2>&1 &
    local pid=$!
    say "启动 bridge pid=$pid"
}

rotate() {
    if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 20971520 ]; then
        mv "$LOG" "$LOG.$(date +%Y%m%d%H%M)"
        say "日志超过 20MB，已切分"
    fi
}

say "bridge 守护启动（每 ${CHECK_SEC}s 巡检一次）"

while true; do
    if ! running; then
        say "bridge 不在，拉起"
        start
        sleep 8
    fi
    rotate
    sleep "$CHECK_SEC"
done
