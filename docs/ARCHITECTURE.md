# SenTrixWhale 架构设计 (261102)

## 系统全景
```
QQ(NapCat) → bridge(对话/护栏/质检) → api(SHW适配器) → SHW 2.0(记忆大坝)
                  ↑                    ↑
              media(入库管线)     storage(本地缓存)
```

## 模块职责
| 模块 | 职责 | 负责人 |
|---|---|---|
| `bridge/` | QQ对话入口/护栏/记忆质检/DS调用 | CEA |
| `api/` | SHW检索API适配器/契约封装/多通道路由 | CEA → 224-12 |
| `media/` | 照片/视频入库管线(caption→索引→SHW import) | CEA → 224-12 |
| `demo/` | 检索演示服务(7738端口) | CEA |
| `scripts/` | 部署/start.sh/stop.sh/healthcheck.sh | 224-13 |
| `monitoring/` | 日志轮转/指标采集/告警规则 | 224-13 |
| `tests/` | 契约测试/端到端测试/回归测试 | 224-13 |
| `docs/` | API文档/运维手册/部署指南 | CEA + 224-13 |
| `storage/` | 本地记忆缓存/索引快照 | 224-12 |
| `plugins/` | 插件架构预留(桌宠/B站搭子) | TBD |
| `cli/` | 命令行工具(记忆管理/质检运行) | TBD |
| `config/` | 多环境配置模板/密钥管理 | CEA |

## 数据流
1. **对话流**: 用户QQ消息 → bridge解析 → DS生成回答(附SHW检索证据) → 返回QQ
2. **记忆写入流**: 用户发照片/事件 → media管线 → caption生成 → SHW入库 → 索引更新
3. **检索流**: 用户问"上周拍了什么" → bridge → api.shwSearch → SHW四通道检索 → 证据链返回

## 阶段里程碑
- **Week 1**: 检索全通(已达成) + 媒体入库管线alpha + 部署脚本
- **Week 2**: 端到端闭环(发照片→入库→检索→回答) + 监控告警
- **Week 3**: 私域验证(5-10用户) + 插件架构预留

## 关键决策
1. **记忆库位置**: 224起SHW 2.0(同缸local-first)
2. **双记忆并存**: memory.json(快) + SHW(深)
3. **隐私分级**: 记忆本地/对话过QQ/模型可切换本地
4. **模型演进**: DS Flash(原型) → Qwen3.5-Q4KM(产品化)
