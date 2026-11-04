# monitoring/alert_rules.md — SenTrixWhale 告警规则
# 定义: 基于Prometheus指标的告警阈值, 适配企业微信/邮件通知

## 告警规则

### 严重(CRITICAL) — 立即处理
| 告警 | 条件 | 阈值 | 动作 |
|------|------|------|------|
| SHW_API_DOWN | whale_shw_api_up == 0 持续2min | 1→0 | 企业微信@值班 + 邮件 |
| NAPCAT_DOWN | whale_napcat_up == 0 持续2min | 1→0 | 企业微信@值班 + 邮件 |
| BRIDGE_DOWN | whale_bridge_up == 0 持续1min | 1→0 | 企业微信@值班 + 邮件 |
| 高错误率 | 5min内error_rate > 10% | error/total > 0.1 | 邮件通知 |
| 磁盘满 | 可用空间 < 10% | df / < 10% | 企业微信 + 邮件 |

### 警告(WARNING) — 关注即可
| 告警 | 条件 | 阈值 | 动作 |
|------|------|------|------|
| 高延迟 | p95延迟 > 2s 持续5min | > 2000ms | 邮件通知 |
| 内存泄漏 | heap_used 持续增长1h | 斜率 > 5MB/min | 邮件通知 |
| 请求堆积 | 活跃连接数 > 50 | active > 50 | 邮件通知 |
| 日志过大 | 日志目录 > 500MB | du -sh logs > 500M | 邮件通知(触发logrotate) |

### 信息(INFO) — 仅记录
| 告警 | 条件 | 动作 |
|------|------|------|
| 服务重启 | 进程重启事件 | 写入日志 |
| 每日摘要 | 每天08:00 | 邮件发送昨日请求量/错误率/延迟 |

## 通知渠道配置

### 企业微信(Webhook)
```bash
# 企业微信群机器人Webhook URL(填入实际值)
WX_WEBHOOK="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY"

# 发送函数
send_wx() {
    curl -s "$WX_WEBHOOK" -H 'Content-Type: application/json' -d "{
        \"msgtype\": \"text\",
        \"text\": {
            \"content\": \"🐳 SenTrixWhale告警: $1\"
        }
    }"
}
```

### 邮件(SMTP)
```bash
# SMTP配置见工程内部文档(不暴露密码)
SMTP_SERVER="smtp.qq.com:587"
FROM="zhxbayernfan3@qq.com"
TO="zhxbayernfan3@qq.com"
```

## 日志轮转
- 频率: 每天
- 保留: 7天
- 压缩: gzip
- 触发: `sudo logrotate -f /home/sscy/lingbot-map/005SenTrixWhale/monitoring/logrotate.conf`
