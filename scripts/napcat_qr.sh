#!/bin/bash
# 重新生成 QQ 登录二维码并打开（一次取回，约 15 秒）
set -uo pipefail
VM=stw-docker
Q=/Users/rm002/Desktop/qq_qrcode.png
L() { limactl shell $VM -- sudo docker "$@" 2>&1 | grep -v "unable to resolve host"; }

t0=$(date +%s)
echo "[1/3] 删旧码 + 重启…"
L exec napcat-stw rm -f /app/napcat/cache/qrcode.png >/dev/null 2>&1 || true
L restart napcat-stw >/dev/null

echo "[2/3] 等 QQ 启动…"
sleep 11

echo "[3/3] 取二维码…"
rm -f "$Q"
L exec napcat-stw sh -c "base64 /app/napcat/cache/qrcode.png" | base64 -d > "$Q" 2>/dev/null

if [ -s "$Q" ]; then
    open "$Q"
    echo "=== 完成，用时 $(( $(date +%s) - t0 )) 秒 ==="
    echo "★ 手机 QQ 扫码 → **手机上点【确认登录】**"
    echo "  图片: $Q"
else
    echo "!! 取码失败，容器日志："
    L logs --tail 8 napcat-stw
    exit 1
fi
