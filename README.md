# Upload to CF

一个基于 Cloudflare Workers 的纯后端文件上传/下载服务。

## 功能

- 上传文件，返回 4 位短 key
- 通过 key 下载文件（下载后自动删除）
- 文件 24 小时后自动过期删除
- API Key 认证（支持 `Authorization: Bearer sk-xxx` 格式）
- 定时清理过期文件

## 技术栈

| 组件 | 用途 | Cloudflare 服务 |
|------|------|----------------|
| API 服务 | 路由处理 | Workers |
| 文件存储 | 存储上传的文件 | R2 (10GB 免费) |
| 元数据 | 文件记录 | D1 (SQLite) |
| API Key | 认证 | KV |
| 定时清理 | 清理过期文件 | Cron Triggers |

## 项目结构

```
upload/
├── src/
│   ├── index.ts       # Worker 入口 & 路由
│   ├── auth.ts        # API Key 认证
│   ├── upload.ts      # 上传处理
│   ├── download.ts    # 下载处理
│   └── cleanup.ts     # 定时清理过期文件
├── schema.sql         # D1 建表语句
├── wrangler.toml      # Cloudflare 配置
├── package.json
└── tsconfig.json
```

## 部署步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 R2 Bucket

```bash
npx wrangler r2 bucket create upload-files
```

### 3. 创建 D1 数据库

```bash
npx wrangler d1 create upload-db
```

创建完成后，会输出类似以下内容：

```
✅ Successfully created DB 'upload-db' in region APAC
Created your new D1 database.

[[d1_databases]]
binding = "DB"
database_name = "upload-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

将输出的 `database_id` 填入 `wrangler.toml` 中。

### 4. 初始化 D1 数据库表

```bash
npx wrangler d1 execute upload-db --file=schema.sql
```

### 5. 创建 KV Namespace

```bash
npx wrangler kv:namespace create API_KEYS
```

创建完成后，会输出类似以下内容：

```
✅ Successfully created KV namespace with id "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

将输出的 `id` 填入 `wrangler.toml` 中。

### 6. 写入 API Key

```bash
npx wrangler kv:key put --namespace-id=<你的KV_ID> "sk-your-secret-key" "active"
```

例如：

```bash
npx wrangler kv:key put --namespace-id=xxxxxxxx "sk-my-token-123" "active"
```

> 建议使用 `sk-` 前缀来区分 API Key，格式类似 OpenAI 的 API Key。

### 7. 部署

```bash
npm run deploy
```

部署完成后会输出你的 Worker 域名，例如 `https://upload.xxx.workers.dev`。

## 使用方法

### 上传文件

```bash
curl -X POST https://your-worker.workers.dev/upload \
  -H "Authorization: Bearer sk-your-secret-key" \
  -F "file=@/path/to/your/file.zip"
```

**返回示例：**

```json
{
  "key": "a3f8",
  "filename": "file.zip",
  "size": 12345,
  "expires_at": "2026-06-30T14:30:00.000Z"
}
```

### 下载文件

```bash
curl -o output.zip \
  -H "Authorization: Bearer sk-your-secret-key" \
  https://your-worker.workers.dev/download/a3f8
```

> 下载后文件会自动从服务器删除，每个 key 只能下载一次。

### 健康检查

```bash
curl https://your-worker.workers.dev/health
```

**返回：**

```json
{
  "status": "ok"
}
```

## 注意事项

1. **API Key 安全性**：请使用强密码作为 API Key，建议格式 `sk-` 开头 + 随机字符串
2. **文件大小限制**：单个文件最大 100MB
3. **过期时间**：文件上传后 24 小时自动删除（由 Cron 定时任务每小时清理一次）
4. **一次性下载**：每个文件只能下载一次，下载后立即删除
5. **纯后端服务**：无管理界面，完全通过 API 调用
6. **所有请求走 HTTPS**：Cloudflare 自动提供 SSL/TLS 加密

## License

MIT