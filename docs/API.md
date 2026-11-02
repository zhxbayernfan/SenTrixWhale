# SenTrixWhale API文档(261102)

## SHW检索API

### POST /api/v1/search

检索SHW记忆库, 支持多通道(visual/text/episodic/semantic)。

**请求:**
```json
{
  "q": "上周拍了什么",
  "top_k": 5,
  "channels": ["visual", "text", "episodic", "semantic"]
}
```

**响应:**
```json
{
  "query": "上周拍了什么",
  "backend": "sentrix_home_web_2.0",
  "degraded": false,
  "items": [
    {
      "asset": {
        "id": "abc123",
        "file_name": "IMG_20261025_143022.jpg",
        "media_type": "image/jpeg",
        "caption": "海边日落, 三个人在沙滩上"
      },
      "score": 0.92,
      "channels": ["visual", "episodic"]
    }
  ]
}
```

**字段说明:**

| 字段 | 类型 | 说明 |
|------|------|------|
| query | string | 回显查询字符串 |
| backend | string | 检索后端标识 |
| degraded | boolean | 是否降级模式(部分通道不可用) |
| items | array | 命中结果列表 |
| items[].asset | object | 媒体资产信息 |
| items[].asset.id | string | 资产唯一ID |
| items[].asset.file_name | string | 文件名 |
| items[].asset.media_type | string | MIME类型 |
| items[].asset.caption | string | VLM生成的描述 |
| items[].score | float | 相关度分数(0-1) |
| items[].channels | array | 命中该资产的通道 |

**错误码:**

| 状态码 | 含义 |
|--------|------|
| 200 | 检索成功 |
| 400 | 查询为空或参数错误 |
| 500 | 服务器内部错误 |
| 503 | SHW服务不可用 |

### GET /api/v1/search?q=xxx&top_k=N

GET方式检索(参数同上, 通过URL传递)。

## Demo服务

### GET /

返回检索演示页面(HTML表单)。

### POST /

提交查询, 返回检索结果页面。

**请求:**
```json
{ "q": "海边" }
```

**响应:** HTML页面, 包含命中结果列表。

## 健康检查

### GET /api/health (SHW)

**响应:** `{"status": "ok"}` (200)

### GET /health (Metrics)

**响应:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "requests": 1234,
  "errors": 5
}
```

## 指标端点

### GET /metrics (Metrics服务, 9090端口)

Prometheus格式指标:

```
# HELP whale_requests_total Total requests to SenTrixWhale
# TYPE whale_requests_total counter
whale_requests_total 1234

# HELP whale_request_duration_seconds Request latency in seconds
# TYPE whale_request_duration_seconds histogram
whale_request_duration_seconds_bucket{le="0.1"} 800
whale_request_duration_seconds_bucket{le="0.25"} 1100
whale_request_duration_seconds_bucket{le="0.5"} 1200
whale_request_duration_seconds_bucket{le="+Inf"} 1234
whale_request_duration_seconds_sum 123.456
whale_request_duration_seconds_count 1234

# HELP whale_shw_api_up SHW API health (1=up, 0=down)
# TYPE whale_shw_api_up gauge
whale_shw_api_up 1
```

## 媒体入库API(阶段2, 规划中)

### POST /api/v1/ingest

提交媒体文件到SHW入库管线。

**请求:** multipart/form-data 或 JSON(带URL)

**响应:**
```json
{
  "status": "accepted",
  "task_id": "ingest-abc123",
  "estimated_time_seconds": 30
}
```

## 记忆质检(阶段3, 规划中)

### POST /api/v1/quality-check

对指定记忆条目进行质检。

**请求:**
```json
{
  "asset_id": "abc123",
  "dimensions": ["caption_accuracy", "metadata_completeness", "retrievability"]
}
```

**响应:**
```json
{
  "asset_id": "abc123",
  "overall_score": 0.85,
  "details": {
    "caption_accuracy": 0.9,
    "metadata_completeness": 0.8,
    "retrievability": 0.85
  }
}
```
