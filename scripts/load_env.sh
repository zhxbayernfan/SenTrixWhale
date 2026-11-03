#!/bin/bash
# scripts/load_env.sh — 加载部署配置(被其他脚本source)
# 优先读取 .env.deploy, 其次 .env.deploy.example

set -e
BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$BASE_DIR/.env.deploy"

if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
else
    echo "⚠️  $ENV_FILE 不存在, 使用默认值(复制 .env.deploy.example 并修改)"
    set -a
    source "$BASE_DIR/.env.deploy.example"
    set +a
fi
