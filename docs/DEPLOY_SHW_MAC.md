# SenTrixWhale SHW 2.0 Mac M4 部署指南

> 目标机器: Mac Mini M4 (ARM64, macOS 12+)
> 参考: SHW 2.0 官方 mac-mini-legacy runbook

## 架构差异(Mac M4 vs Linux 3090)

| 能力 | Linux 3090 | Mac M4 | 说明 |
|------|-----------|--------|------|
| VLM | vLLM / llama-cuda | llama-server Metal | M4统一内存, 无GPU显存概念 |
| 文本嵌入 | BGE-M3 (GPU) | BGE-M3 (CPU) | CPU推理, 速度较慢 |
| 视觉嵌入 | WeMM (CUDA) | Chinese-CLIP (CPU) | Mac无CUDA, 用legacy方案 |
| 人脸 | CUDA+CPU | CPU only | onnxruntime CPU |
| 向量库 | qdrant | qdrant | 同 |
| 部署profile | server | mac | profile自动适配 |

## 1. 前置条件

| 依赖 | 安装方式 |
|------|----------|
| Python 3.11+ | `brew install python@3.11` |
| Homebrew | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| Xcode CLT | `xcode-select --install` |
| Git | `brew install git` |

## 2. 克隆仓库

```bash
cd ~
git clone --depth 1 https://github.com/ysh12304124/sentrix-home-web-2.0.git
cd sentrix-home-web-2.0
```

## 3. Python环境

```bash
# Mac M4用Python 3.11
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e "apps/api[dev]"
pip install pydantic-settings
```

## 4. 模型准备

### 4.1 llama-server (VLM)

```bash
# 方案A: 编译llama.cpp (Metal)
git clone --depth 1 https://github.com/ggerganov/llama.cpp.git
cd llama.cpp && mkdir build && cd build
cmake .. -DLLAMA_METAL=ON -DLLAMA_METAL_EMBED_LIBRARY=ON
cmake --build . -j8
# 产出: bin/llama-server

# 下载模型(需提前准备)
mkdir -p ~/models
# qwen35-q4km.gguf + qwen35-mmproj-f16.gguf
```

### 4.2 BGE-M3 (文本嵌入)

```bash
mkdir -p ~/models/bge-m3
# 从HuggingFace下载BAAI/bge-m3权重
```

### 4.3 Chinese-CLIP (视觉嵌入)

```bash
# 2.0仓库内含Chinese-CLIP, 通过legacy_clip_sidecar.py加载
# 权重自动下载到 ~/.cache/clip/
```

## 5. 启动服务

### 5.1 一键启动(Mac profile)

```bash
cd ~/sentrix-home-web-2.0
./scripts/deploy/start_legacy_mac.sh
```

该脚本会依次:
1. 设置 `SENTRIX_DEPLOYMENT_PROFILE=mac`
2. 设置 `SENTRIX_EMBEDDING_SCHEME=legacy`
3. 设置 `FACE_PROVIDERS=CPUExecutionProvider`
4. 启动 8100 llama-server
5. 启动 8101 BGE-M3 侧车
6. 启动 8103 Chinese-CLIP 侧车
7. 启动 8191 API
8. 等待三个模型健康检查通过

### 5.2 手动启动(排障用)

```bash
# llama-server
nohup ./llama.cpp/build/bin/llama-server \
  -m ~/models/qwen35-q4km.gguf \
  --mmproj ~/models/qwen35-mmproj-f16.gguf \
  --host 127.0.0.1 --port 8100 \
  --ctx-size 8192 --parallel 1 \
  --image-min-tokens 1024 \
  --reasoning off &

# BGE-M3 侧车
nohup .venv/bin/python scripts/maintenance/bge_text_sidecar.py \
  --port 8101 &

# Chinese-CLIP 侧车
nohup .venv/bin/python scripts/maintenance/legacy_clip_sidecar.py \
  --port 8103 &

# API
SENTRIX_DEPLOYMENT_PROFILE=mac \
SENTRIX_EMBEDDING_SCHEME=legacy \
FACE_PROVIDERS=CPU \
.venv/bin/python -m uvicorn --factory sentrix.main:create_app \
  --host 0.0.0.0 --port 8191
```

## 6. 验证

```bash
# API健康
curl http://127.0.0.1:8191/api/health

# llama-server
curl http://127.0.0.1:8100/health

# BGE-M3
curl http://127.0.0.1:8101/health

# Chinese-CLIP
curl http://127.0.0.1:8103/health

# 检索测试
curl "http://127.0.0.1:8191/api/v1/search?q=test&top_k=3"
```

## 7. PhotoBench(可选)

```bash
./scripts/deploy/start_photobench_mac.sh
# 或手动:
SENTRIX_DEPLOYMENT_PROFILE=mac \
PHOTOBENCH_DATA_ROOT=~/GitHub/Sentrix-Home-Web/services/photobench/data \
.venv/bin/python -m uvicorn --factory photobench.main:create_app \
  --host 0.0.0.0 --port 8772 --app-dir apps/photobench/src
```

## 8. 端口总览

| 服务 | 端口 | 用途 |
|------|------|------|
| API | 8191 | 主产品API |
| llama-server | 8100 | VLM推理 |
| BGE-M3 | 8101 | 文本嵌入 |
| Chinese-CLIP | 8103 | 视觉嵌入 |
| PhotoBench | 8772 | 评测服务 |

## 已知坑

1. **ctx-size不宜过大**: Mac M4统一内存, ctx-size > 8192可能导致OOM
2. **CPU嵌入慢**: BGE-M3和Chinese-CLIP都在CPU上跑, 单条嵌入可能需要数秒
3. **llama.cpp编译**: 必须用CMake, 不能只用Make; 需 `-DLLAMA_METAL=ON`
4. **路径差异**: Mac用 `~/` 而非 `/home/sscy/`; Python 用 `python3.11` 而非 `python3`
5. **profile=mac**: 墙钟600s(非180s), QA并发2(非None), 导入超时86400s(非7200s)
