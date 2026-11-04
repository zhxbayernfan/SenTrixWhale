# SenTrixWhale 部署指南

> 从零到跑通, 预计15分钟

## 前置条件

| 依赖 | 版本 | 检查方式 |
|------|------|----------|
| Node.js | >= 22 | `node -v` |
| Docker | >= 20 | `docker --version` |
| SHW 2.0 | 运行中 | `curl http://127.0.0.1:9598/api/health` |

## 一、环境准备

```bash
# 1. 确认代码位置
cd $SENTRIXWHALE_ROOT

# 2. 检查依赖
node -v        # 应 >= 22
docker --version

# 3. 确认SHW 2.0运行
curl http://127.0.0.1:9598/api/health
# 应返回 200 + {"status": "ok"}
```

## 二、NapCat3配置

```bash
# NapCat3以Docker方式运行(已在005SenTrixWhale/napcat3/配置好)
# 启动NapCat容器(首次)
docker run -d --name napcat3 \
  -v $SENTRIXWHALE_ROOT/napcat3/QQ:/app/QQ \
  -v $SENTRIXWHALE_ROOT/napcat3/config:/app/config \
  -p 3001:3001 \
  napcat/napcat:latest

# 或已有容器时
docker start napcat3

# 验证NapCat
curl http://127.0.0.1:3001/
# 应返回 "ok"
```

## 三、一键启动

```bash
cd $SENTRIXWHALE_ROOT
bash scripts/start.sh
```

输出应类似:
```
🐳 SenTrixWhale 启动中...
✅ Node.js 22
✅ SHW 2.0 API (9598) 运行中
✅ NapCat3 运行中
🔄 启动 Bridge...

=== 健康检查 ===
NapCat WS: ✅
SHW API:   ✅
Demo:      ✅

🎉 SenTrixWhale 启动完成!
   演示地址: http://192.168.0.224:7738
   日志目录: $SENTRIXWHALE_ROOT/logs
```

## 四、验证

```bash
# 健康检查
bash scripts/healthcheck.sh

# 契约测试
node tests/contract.test.js

# 端到端测试
node tests/e2e.test.js
```

## 五、systemd服务(可选, 开机自启)

```bash
# 复制服务文件
sudo cp scripts/senTrixWhale.service /etc/systemd/system/

# 重新加载systemd
sudo systemctl daemon-reload

# 启用并启动
sudo systemctl enable senTrixWhale
sudo systemctl start senTrixWhale

# 查看状态
sudo systemctl status senTrixWhale
```

## 六、监控面板

```bash
# 启动指标采集服务
node monitoring/metrics.js &

# 访问指标
curl http://192.168.0.224:9090/metrics

# 健康端点
curl http://192.168.0.224:9090/health
```

## 七、停止服务

```bash
# 正常停止(保留NapCat)
bash scripts/stop.sh

# 停止全部(含NapCat)
bash scripts/stop.sh --stop-napcat
```

## 端口总览

| 服务 | 端口 | 用途 |
|------|------|------|
| SHW API | 9598 | 记忆检索API |
| NapCat WS | 3001 | QQ协议WebSocket |
| Bridge | - | 对话桥接进程 |
| Demo | 7738 | 检索演示页面 |
| Metrics | 9090 | Prometheus指标 |
| SHW Embedding | 8101 | 文本向量化 |
| SHW CLIP | 8103 | 图像向量化 |
| llama-server | 8100 | 本地LLM推理 |

## 常见问题

**Q: SHW 9598端口不通?**
A: 确认SHW已启动: `cd 004SHW/sentrix-home-web-2.0 && make dev`

**Q: NapCat连不上?**
A: 检查Docker容器状态: `docker ps | grep napcat3`

**Q: Node版本太低?**
A: 用nvm升级: `nvm install 22`
