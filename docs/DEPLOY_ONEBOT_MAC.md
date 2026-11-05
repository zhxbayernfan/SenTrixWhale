# SenTrixWhale OneBot Mac M4 部署指南

> 方案: Lagrange.OneBot (osx-arm64, SelfContained)
> 来源: https://github.com/LagrangeDev/Lagrange.Core/releases/download/nightly/

## 架构

```
QQ协议 ← Lagrange.OneBot(35MB SelfContained) → WebSocket(OneBot11, 3001) → bridge.js
                                                    ↓
                                             HTTP API(3000)
```

## 1. 下载与安装

```bash
# SSH到0.90
ssh rm002@192.168.0.90

# 下载
curl -L https://github.com/LagrangeDev/Lagrange.Core/releases/download/nightly/Lagrange.OneBot_osx-arm64_net9.0_SelfContained.tar.gz -o /tmp/lagrange.tar.gz

# 解压到/opt
sudo mkdir -p /opt/lagrange
sudo tar -xzf /tmp/lagrange.tar.gz -C /opt/lagrange/
```

## 2. 配置

配置文件: `/opt/lagrange/appsettings.json`

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft": "Warning"
    }
  },
  "SignServerUrl": "",
  "Account": {
    "Uin": 3994693062,
    "Protocol": "Linux"
  },
  "OneBot": {
    "HttpHosts": [
      {
        "Host": "127.0.0.1",
        "Port": 3000
      }
    ],
    "WsHosts": [
      {
        "Host": "127.0.0.1",
        "Port": 3001
      }
    ],
    "HeartBeatInterval": 5000
  }
}
```

## 3. 启动

```bash
cd /opt/lagrange
./Lagrange.OneBot
```

## 4. 验证

```bash
curl http://127.0.0.1:3000/
curl http://127.0.0.1:3001/
```

## 5. 端口总览

| 服务 | 端口 | 用途 |
|------|------|------|
| Lagrange HTTP API | 3000 | OneBot11 HTTP |
| Lagrange WS | 3001 | OneBot11 WebSocket |

## 已知坑

1. **首次登录需要扫码**：SSH下无法扫码，需WebUI或临时转发
2. **SignServer**：如需签名服务，需额外配置SignServerUrl
3. **Protocol**：Linux协议最适合服务端部署
