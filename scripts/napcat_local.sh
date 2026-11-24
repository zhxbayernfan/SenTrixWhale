#!/bin/bash
# 本机 NapCat（lima VM 里跑）的一键操作
# 用法:
#   scripts/napcat_local.sh qr      重启并导出新二维码到桌面
#   scripts/napcat_local.sh status  看容器/端口/登录状态
#   scripts/napcat_local.sh tunnel  重建 3000/3001 的 SSH 隧道
set -uo pipefail
VM=stw-docker
login() { limactl shell $VM -- sudo docker "$@" 2>&1 | grep -v "unable to resolve host"; }

case "${1:-status}" in
  qr)
    login restart napcat-stw >/dev/null
    echo "等 QQ 启动…"
    sleep 25
    limactl shell $VM -- sudo docker cp napcat-stw:/app/napcat/cache/qrcode.png /Users/rm002/Desktop/qq_qrcode.png 2>/dev/null
    echo "二维码已更新：~/Desktop/qq_qrcode.png"
    login logs --since 1m napcat-stw | grep -iE "二维码|登录|快速" | tail -3
    ;;
  tunnel)
    pkill -f "ssh.*-L 3000:127.0.0.1:3000" 2>/dev/null
    nohup ssh -F /Users/rm002/.lima/$VM/ssh.config -N \
      -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 lima-$VM > /tmp/tunnel.log 2>&1 &
    sleep 3
    curl -s --max-time 5 http://127.0.0.1:3000/get_login_info | head -c 160; echo
    ;;
  status)
    echo "--- 容器 ---"; login ps --format "{{.Names}} {{.Status}} {{.Ports}}"
    echo "--- 登录 ---"; curl -s --max-time 5 http://127.0.0.1:3000/get_login_info 2>&1 | head -c 200; echo
    ;;
esac
