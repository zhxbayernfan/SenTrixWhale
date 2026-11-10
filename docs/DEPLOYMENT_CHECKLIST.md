# SenTrixWhale部署检查清单

## 前置条件
- [ ] Node.js >= 22
- [ ] llama-server已编译（/home/sscy/llama.cpp-new/build/bin/llama-server）
- [ ] Qwen3.5模型文件就绪
- [ ] NapCat Docker已安装
- [ ] SSH密钥配置完成

## 部署步骤
1. 克隆仓库：`git clone https://github.com/zhxbayernfan/SenTrixWhale.git`
2. 安装依赖：`npm install`（如果需要）
3. 配置config.json：填入QQ号、NapCat token等
4. 启动llama-server：使用scripts/start_bridge.sh
5. 启动bridge：systemd服务自动管理
6. 验证：curl http://127.0.0.1:8100/v1/models

## 稳定性保障
- systemd自动重启（Restart=always）
- cron健康检查（每5分钟）
- 全局异常处理（uncaughtException/unhandledRejection）
- WS看门狗（90秒无脉重连）

## 常见问题
1. bridge崩溃：检查llama-server是否运行
2. 消息不回复：检查WS连接和NapCat状态
3. 身份识别错误：检查config.json的owners配置
