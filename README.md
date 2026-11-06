# SenTrixWhale

给家庭记忆助手装上QQ对话入口的工程。记忆库在用户本地,对话过QQ,模型可切换。

## 架构

```
QQ(NapCat) → bridge(对话/护栏/质检) → api(SHW适配器) → SHW 2.0
                  ↑                    ↑
              media(入库管线)     storage(本地缓存)
```

模块职责见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

### 前置条件
- SHW 2.0运行于9598端口
- NapCat已配置(OneBot11协议)
- Node.js >= 22
- 本地模型: llama-server(8100端口)或云端DS API

### 启动
```bash
source Users_Launch_Route.txt  # 路径配置
bash scripts/start.sh
bash scripts/healthcheck.sh
```

端口总览: NapCat WS 3001 | NapCat WebUI 7737 | SHW 9598。

## 路线

| 阶段 | 验收 |
|------|------|
| 1.对话入口 | 手机QQ问"上周拍了什么"→SHW检索回答 |
| 2.媒体入库 | 发照片后隔天问细节→回答含原始描述 |
| 3.记忆结构化 | 问"X和Y什么关系"→图谱检索回答 |

## 已验证原型

费用护栏、定量日记、书房、图像识别(39张回归全绿)、防幻觉、视频转文字。

## 目录

| 目录 | 说明 |
|------|------|
| `bridge/` | QQ对话入口/护栏/记忆质检/模型调用 |
| `api/` | SHW检索API适配器 |
| `media/` | 照片/视频入库管线 |
| `scripts/` | 部署/start.sh/stop.sh/healthcheck.sh |
| `monitoring/` | 日志轮转/指标采集/告警规则 |
| `tests/` | 契约/端到端/性能/失败场景测试 |
| `docs/` | 架构/部署/运维/API文档 |

## 文档

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构设计/模块职责/数据流 |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | 从零到跑通 |
| [OPERATIONS.md](docs/OPERATIONS.md) | 运维手册/故障排查 |
| [API.md](docs/API.md) | API契约 |
