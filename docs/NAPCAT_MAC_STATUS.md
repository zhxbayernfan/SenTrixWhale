# NapCat Mac M4 部署记录(261104)

## 现状
- 0.90: Mac Mini M4 (macOS 15.3.1, ARM64 T8132)
- SSH: rm002@192.168.0.90 (密码123456)
- Xcode CLT: ✅ 已安装
- Homebrew: ✅ 已安装 (/opt/homebrew)
- colima: ✅ 已安装
- docker CLI: ✅ 已安装 (29.9.3)
- colima VM: ❌ 启动失败(纯SSH下Mac安全策略阻止虚拟化)
- Docker Desktop: ❌ cask安装失败(无GUI)

## 阻塞原因
Mac M4上运行容器需要虚拟化：
- Docker Desktop需要GUI启动
- colima需要Lima/QEMU，首次下载disk image(~500MB)，SSH下被安全策略阻止

## 下一步方案(待zhx决策)
1. **现场辅助**：去0.90点一下Docker Desktop启动，之后SSH全管
2. **备选**：224跑NapCat，0.90只跑llama+bridge

## 成功后的步骤(记录备用)
```bash
# 1. 拉镜像
docker pull docker.m.daocloud.io/mlikiowa/napcat-docker:latest

# 2. 创建目录
mkdir -p /Users/rm002/napcat/config /Users/rm002/napcat/QQ

# 3. 启动容器
docker run -d --name napcat --restart=always \
  -p 3000:3000 -p 3001:3001 -p 7737:6099 \
  -v /Users/rm002/napcat/config:/app/napcat/config \
  -v /Users/rm002/napcat/QQ:/app/.config/QQ \
  docker.m.daocloud.io/mlikiowa/napcat-docker:latest

# 4. 验证
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3001/
```

## 端口规划
- 3000: NapCat HTTP API
- 3001: NapCat WebSocket (OneBot11)
- 7737: NapCat WebUI
