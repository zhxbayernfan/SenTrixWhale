#!/bin/bash
# 在 macOS 上装 QQ + LiteLoaderQQNT，并判定这条版本是否可行
#
# 用法: scripts/install_liteloader_mac.sh /tmp/QQ_6.9.96.dmg
#
# 判定逻辑（关键）：
#   如果 QQ 的 Resources/app/ 下有 application.json —— 说明有完整性校验，
#   改 package.json 会被无视，LiteLoader 装不上（QQ 7.0.3 实测如此）。
#   没有这个文件才继续装。
set -euo pipefail

DMG="${1:?用法: $0 <QQ.dmg>}"
LITELOADER_DIR="/Users/rm002/SenTrixWhale/tools/LiteLoaderQQNT"
PROFILE="$HOME/.liteloaderqqnt"

echo "=== 1. 卸载旧 QQ ==="
killall QQ 2>/dev/null || true
sleep 1
if [ -d /Applications/QQ.app ]; then
    mv /Applications/QQ.app "/Applications/QQ.app.bak_$(date +%H%M)"
fi

echo "=== 2. 挂载 dmg ==="
hdiutil attach "$DMG" -nobrowse -quiet
VOL=$(ls /Volumes | grep -i '^QQ' | head -1)
[ -n "$VOL" ] || { echo "挂载失败"; exit 1; }
cp -R "/Volumes/$VOL/QQ.app" /Applications/
hdiutil detach "/Volumes/$VOL" -quiet || true

VERSION=$(defaults read /Applications/QQ.app/Contents/Info.plist CFBundleShortVersionString)
echo "已安装版本: $VERSION"

APP=/Applications/QQ.app/Contents/Resources/app

echo "=== 3. 判定：有没有完整性校验 ==="
if [ -f "$APP/application.json" ]; then
    echo "[结论] 有 application.json —— 该版本带完整性校验，LiteLoader 不可装"
    echo "        文件: $APP/application.json"
    echo "        QQ 会校验 package.json 的哈希，改 main 无效。"
    exit 2
fi
echo "[结论] 无 application.json —— 可以继续"

echo "=== 4. 注入 LiteLoader ==="
cp "$APP/package.json" "$APP/package.json.bak_lite"
mkdir -p "$APP/app_launcher"
cat > "$APP/app_launcher/LiteLoader.js" <<JS
try { require('fs').writeFileSync('/tmp/liteloader_probe.txt', 'loaded ' + new Date().toISOString()); } catch (e) {}
try { require(String.raw\`$LITELOADER_DIR\`); } catch (e) {
  try { require('fs').appendFileSync('/tmp/liteloader_probe.txt', '\nrequire failed: ' + e.message); } catch (_) {}
}
JS
python3 - "$APP/package.json" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d['main'] = './app_launcher/LiteLoader.js'
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=2)
print('main →', d['main'])
PY

echo "=== 5. 启动验证 ==="
rm -f /tmp/liteloader_probe.txt
export LITELOADERQQNT_PROFILE="$PROFILE"
mkdir -p "$PROFILE"
( /Applications/QQ.app/Contents/MacOS/QQ > /tmp/qq_boot.log 2>&1 & )
sleep 12
if [ -f /tmp/liteloader_probe.txt ]; then
    echo "[成功] LiteLoader 已加载:"
    cat /tmp/liteloader_probe.txt
    echo
    echo "数据目录: $PROFILE"
    ls -la "$PROFILE" 2>/dev/null | head -5
else
    echo "[失败] QQ 没执行注入的 JS——校验或被绕过，但不是我们的脚本"
    exit 3
fi
