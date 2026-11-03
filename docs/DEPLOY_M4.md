# SenTrixWhale Mac M4(0.37) 部署指南

## 前置条件
- Mac Mini M4 (arm64, macOS)
- Node.js >= 22
- Xcode Command Line Tools (已装, 用于Metal编译)
- SSH: test@192.168.0.37 (密码512807)

## 环境安装

### Node.js 22
```bash
curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-darwin-arm64.tar.xz -o /tmp/node22.tar.xz
cd /tmp && tar -xJf node22.tar.xz
mkdir -p /Users/test/.local
cp -R node-v22.11.0-darwin-arm64/* /Users/test/.local/
echo 'export PATH=/Users/test/.local/bin:$PATH' >> /Users/test/.zshrc
source /Users/test/.zshrc
node -v  # v22.11.0
```

### llama-server (Metal)
```bash
# 安装cmake
pip3 install cmake
export PATH=/Users/test/Library/Python/3.9/bin:$PATH

# 编译
cd /Users/test
git clone --depth 1 https://github.com/ggerganov/llama.cpp.git
cd llama.cpp && mkdir build && cd build
cmake .. -DLLAMA_METAL=ON -DLLAMA_METAL_EMBED_LIBRARY=ON -DCMAKE_BUILD_TYPE=Release
cmake --build . -j8 --config Release
ls -lh bin/llama-server  # 33K
```

## 模型文件
从224复制:
```bash
# 224→0.37 (需要sshpass)
sshpass -p 512807 scp qwen35-lora-Q4_K_M.gguf test@192.168.0.37:/Users/test/models/
sshpass -p 512807 scp qwen35-lora-mmproj-f16.gguf test@192.168.0.37:/Users/test/models/
```

## 启动服务

### 1. llama-server
```bash
/Users/test/llama.cpp/build/bin/llama-server \
  -m /Users/test/models/qwen35-lora-Q4_K_M.gguf \
  --mmproj /Users/test/models/qwen35-lora-mmproj-f16.gguf \
  --alias qwen35-4b-lora-q4km \
  --host 0.0.0.0 --port 8100 \
  --ctx-size 8192 --parallel 4 --n-gpu-layers 999 \
  --reasoning off --flash-attn on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --ctx-checkpoints 1 --cache-ram 512 \
  --metrics &
```

### 2. bridge
```bash
cd /Users/test/005SenTrixWhale
WHALE_HOME=$(pwd) nohup node bridge/src/bridge.js >> state/bridge.log 2>&1 &
```

### 3. 验证
```bash
curl http://127.0.0.1:8100/v1/models  # 确认模型加载
tail -f state/bridge.log              # 查看bridge日志
```

## 配置适配
bridge/config.json已适配路径 `/Users/test` (非`/home/sscy`)
- ds.baseUrl: http://127.0.0.1:8100/v1 (本地llama)
- shw.apiBase: http://127.0.0.1:9598 (阶段1远程224, enabled=true)

## 已知坑
1. chatLog必须定义在think函数之前(JS const不提升)
2. SHW检索top_k参数API可能不生效(返回总是20条)
3. Mac M4编译需`LLAMA_METAL=1` + CMake (非Make)
4. test用户无sudo权限, 软件装到用户目录
5. rsync传大文件需`--timeout=300`防断连
