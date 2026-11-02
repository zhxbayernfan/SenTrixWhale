# SenTrixWhale 运维手册(261102)

## 日常巡检

```bash
# 每天: 健康检查
bash scripts/healthcheck.sh

# 每周: 运行测试套件
node tests/contract.test.js
node tests/e2e.test.js

# 每月: 性能压测
node tests/performance.test.js
```

## 日志管理

### 日志位置
| 日志 | 路径 |
|------|------|
| Bridge | `logs/bridge.log` + `bridge/bridge.log` |
| Bridge stdout | `logs/bridge-stdout.log` |
| Bridge stderr | `logs/bridge-stderr.log` |

### 日志轮转
```bash
# 手动触发
sudo logrotate -f monitoring/logrotate.conf

# 查看日志大小
du -sh logs/ bridge/ bridge/state/
```

## 故障排查

### 1. SHW API不可达(9598)
```bash
# 检查SHW进程
ps aux | grep sentrix

# 检查端口占用
netstat -tlnp | grep 9598

# 重启SHW
cd 004SHW/sentrix-home-web-2.0 && make dev

# 检查embedding服务
curl http://127.0.0.1:8101/health   # bge-m3
curl http://127.0.0.1:8103/health   # CLIP
curl http://127.0.0.1:8100/health   # llama-server
```

### 2. NapCat断开
```bash
# 检查容器状态
docker ps | grep napcat3

# 重启容器
docker restart napcat3

# 查看NapCat日志
docker logs napcat3 --tail 50

# 检查QQ账号状态(是否被踢/封禁)
# 登录NapCat WebUI查看
```

### 3. Bridge进程崩溃
```bash
# 查看Bridge状态
pgrep -f "005SenTrixWhale/bridge"

# 查看最后日志
tail -50 logs/bridge.log

# 手动重启
cd bridge && node src/bridge.js

# 查看systemd状态(如已安装)
sudo systemctl status senTrixWhale
sudo journalctl -u senTrixWhale --since "1 hour ago"
```

### 4. Demo服务无响应
```bash
# 检查Demo进程
pgrep -f "005SenTrixWhale/demo"

# 查看端口
netstat -tlnp | grep 7738

# 重启Demo
cd demo && node search_demo.js &
```

### 5. 检索无结果
```bash
# 确认SHW有数据
curl "http://127.0.0.1:9598/api/v1/search?q=test&top_k=5"

# 检查SHW日志
cd 004SHW/sentrix-home-web-2.0 && tail -50 logs/api.log

# 检查qdrant向量库
curl http://127.0.0.1:6333/collections

# 检查embedding是否正常
curl http://127.0.0.1:8101/v1/embeddings -H "Content-Type: application/json" -d '{"input": "test"}'
```

### 6. 磁盘空间不足
```bash
# 检查磁盘
df -h /

# 清理日志
bash scripts/stop.sh
rm -rf logs/*.log logs/*.log.*
bash scripts/start.sh

# 清理Docker无用镜像
docker system prune -f

# 清理SHW旧run
cd 004SHW/sentrix-home-web-2.0 && ls -la data/
```

## 备份恢复

### 备份
```bash
# 备份配置
tar czf backup_config_$(date +%Y%m%d).tar.gz \
  bridge/config*.json \
  napcat3/config/ \
  monitoring/

# 备份日志(如需)
tar czf backup_logs_$(date +%Y%m%d).tar.gz logs/

# 备份daily.json(日记数据)
cp bridge/state/daily.json bridge/state/daily.json.bak.$(date +%Y%m%d)
```

### 恢复
```bash
# 恢复配置
tar xzf backup_config_*.tar.gz

# 恢复日记数据
cp bridge/state/daily.json.bak.* bridge/state/daily.json
```

## 监控指标

访问 `http://192.168.0.224:9090/metrics` 查看Prometheus格式指标:

| 指标 | 含义 | 正常值 |
|------|------|--------|
| whale_requests_total | 总请求数 | 递增 |
| whale_request_duration_seconds | 请求延迟分布 | p95 < 500ms |
| whale_errors_total | 总错误数 | < 10% |
| whale_shw_api_up | SHW API状态 | 1 |
| whale_napcat_up | NapCat状态 | 1 |
| whale_bridge_up | Bridge进程 | 1 |
| whale_uptime_seconds | 运行时长 | 递增 |

## 告警

告警规则见 [alert_rules.md](monitoring/alert_rules.md)

- **CRITICAL**: SHW/NapCat/Bridge宕机 → 企业微信+邮件
- **WARNING**: 高延迟/内存泄漏 → 邮件
- **INFO**: 服务重启/每日摘要 → 日志

## 版本升级

```bash
# 1. 停止服务
bash scripts/stop.sh

# 2. 更新代码
cd /home/sscy/lingbot-map/005SenTrixWhale
git pull

# 3. 重新部署
bash scripts/start.sh

# 4. 验证
bash scripts/healthcheck.sh
node tests/contract.test.js
```
