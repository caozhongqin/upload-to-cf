# Upload to CF

一个基于 Cloudflare Workers 的私人文件传输中转站。

上传文件 → 拿到一个 4 位短码 → 发给对方 → 对方用短码下载 → 文件自动删除。

**全程只需在网页上点点点就能部署好，不需要打开终端、不需要安装任何软件。**

## 功能

- 上传文件，返回 4 位短码（如 `a3f8`）
- 对方通过短码下载文件，**下载后自动删除**（阅后即焚）
- 文件 24 小时后自动过期删除（即使没人下载）
- 需要 API Key 才能上传/下载，别人没有密码就没办法用
- 单个文件最大 100MB

## 部署指南（网页点点点版）

你需要一个 Cloudflare 账号。没有的话先去 [dash.cloudflare.com](https://dash.cloudflare.com) 注册一个，免费就行。

有两种部署方式，**选一种即可**：

| 方式 | 适合谁 | 难度 |
|------|--------|------|
| **方式 A：GitHub 导入（推荐）** | 有 GitHub 账号，想自动部署 | ⭐ 最简单 |
| **方式 B：网页编辑器粘贴** | 不想用 GitHub，直接在网页操作 | ⭐⭐ 稍复杂 |

---

## 方式 A：GitHub 导入部署（推荐，全自动）

这是最省事的方式。把代码放到 GitHub，Cloudflare 自动拉取、自动构建部署。你只需要先在 Cloudflare 后台创建好资源，再把 ID 填进配置文件。

### 第 1 步：创建 Cloudflare 资源

以下资源在 Cloudflare 后台手动创建：

#### 创建 R2 存储桶（存文件）

> 免费：10GB 存储

1. Cloudflare 控制台 → 左侧菜单 **R2 对象存储**
2. 点 **创建存储桶**
3. 名称填：`upload-files`，区域选离你最近的
4. 点 **创建存储桶**
5. ✅ 创建好，记住这个名字

#### 创建 D1 数据库（存文件记录）

> 免费：每天 500 万次读取，5GB 存储

1. 左侧菜单 **Workers 和 Pages** → **D1 SQL 数据库**
2. 点 **创建数据库**
3. 名称填：`upload-db`，点 **创建**
4. 进入数据库详情页，**复制数据库 ID**（一长串类似 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`），**先保存到记事本**
5. 点 **控制台** 标签页，粘贴下面这段 SQL：

```sql
CREATE TABLE IF NOT EXISTS files (
  key TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT DEFAULT 'application/octet-stream',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  downloaded INTEGER NOT NULL DEFAULT 0
);
```

6. 点 **执行**，看到成功提示即可

#### 创建 KV 命名空间（存密码）

> 免费：每天 10 万次读取

1. 左侧菜单 **Workers 和 Pages** → **KV**
2. 点 **创建命名空间**
3. 名称填：`API_KEYS`，点 **添加**
4. 进入详情页，**复制命名空间 ID**，**先保存到记事本**
5. 点 **添加键值对**，写入你的密码：
   - 键名：`API_KEY`（**固定写这四个字母**）
   - 值：`7da8a98c-7e27-4bdc-a31b-09b7c25a1d77`（**你自己的密码**）
6. 点 **保存**

> ✅ 很简单：键名固定写 `API_KEY`，值填你的密码。就这一条记录。

---

### 第 2 步：把你的 ID 填进配置文件

打开项目里的 `wrangler.toml` 文件，找到这两处空值：

```toml
# D1 数据库 — 把引号里填入你的 D1 数据库 ID
database_id = ""

# KV 命名空间 — 把引号里填入你的 KV 命名空间 ID
id = ""
```

填上你刚才复制的 ID，看起来像这样：

```toml
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

改好后保存，提交推送到 GitHub。

---

### 第 3 步：在 Cloudflare 连接 GitHub 部署

1. Cloudflare 控制台 → **Workers 和 Pages**
2. 点 **创建**
3. 选 **连接到 Git**
4. 连接你的 GitHub 账号，授权访问这个仓库
5. 选择 `UploadToCF` 仓库
6. 配置构建设置：
   - **框架预设**：`None`
   - **构建命令**：`npm install`
   - **构建输出目录**：留空或写 `.`
7. 点 **保存并部署**

Cloudflare 会自动拉取代码、安装依赖、执行 `wrangler deploy`。构建成功后你就能获得一个 Worker 地址，类似：

`https://upload.你的用户名.workers.dev`

---

### 第 4 步：验证部署成功

浏览器打开：`https://upload.你的用户名.workers.dev/health`

看到 `{"status":"ok"}` 就说明成功了！🎉

---

## 方式 B：网页编辑器粘贴（不用 GitHub）

如果你不想用 GitHub，可以直接在 Cloudflare 网页编辑器里粘贴代码。

### 前置准备

先完成 **方式 A 的第 1 步**（创建 R2、D1、KV 资源）。

### 创建 Worker 并粘贴代码

1. Cloudflare 控制台 → **Workers 和 Pages** → **创建** → **创建 Worker**
2. 名称填：`upload`，点 **创建 Worker**
3. 进入编辑器，**把默认代码全部删掉**
4. 打开项目里的 `worker.js` 文件，**全选复制**所有内容，粘贴到编辑器
5. 点 **部署**

### 绑定 R2、D1、KV

> ⚠️ 变量名称必须和下面写的一字不差

1. 回到 Worker 详情页 → **设置** → **绑定**

| 类型 | 变量名称 | 选择 |
|------|---------|------|
| R2 存储桶 | `FILES_BUCKET` | `upload-files` |
| D1 数据库 | `DB` | `upload-db` |
| KV 命名空间 | `API_KEYS` | `API_KEYS` |

每添加一个就点一次 **部署**。

### 设置定时清理

1. 设置 → **触发器（Cron Triggers）**
2. 添加：`0 * * * *`
3. 保存

### 验证

浏览器打开 `https://upload.你的用户名.workers.dev/health`，看到 `{"status":"ok"}` 就 OK！🎉

---

## 使用方法

### 上传文件

在你的电脑终端里运行（Mac 打开"终端"App，Windows 打开"PowerShell"）：

```bash
curl -X POST https://upload.你的用户名.workers.dev/upload \
  -H "Authorization: Bearer sk-my-secret-key-123" \
  -F "file=@/路径/到/你的文件.zip"
```

> 把 `upload.你的用户名.workers.dev` 换成你的 Worker 地址，把 `sk-my-secret-key-123` 换成你在第 3 步设置的密码，把 `/路径/到/你的文件.zip` 换成你要上传的文件。

成功后会返回：

```json
{
  "key": "a3f8",
  "filename": "文件.zip",
  "size": 12345,
  "expires_at": "2026-06-30T14:30:00.000Z"
}
```

把 `key`（比如 `a3f8`）发给对方就行。

### 使用 helper 脚本（推荐）

项目提供了两个辅助脚本，配合环境变量使用更方便：

**设置环境变量（一次设置，长期有效）**

把下面两行加到你的 `~/.bashrc`（或 `~/.zshrc`）：
```bash
export UPLOAD_SERVER=https://upload.你的用户名.workers.dev
export UPLOAD_API_KEY=你的密码
```

然后执行 `source ~/.bashrc` 生效。

**上传文件**
```bash
./upcf.sh /路径/到/文件.zip
# 输出: a3f8
```

**下载文件**
```bash
./dlcf.sh a3f8
# 恢复到原始文件名保存
./dlcf.sh a3f8 自定义名称.zip
# 指定文件名保存
```

如果没设 `UPLOAD_SERVER`，脚本会报错提示设置。

### 下载文件

对方在终端运行：

```bash
curl -o 下载的文件名.zip \
  -H "Authorization: Bearer sk-my-secret-key-123" \
  https://upload.你的用户名.workers.dev/download/a3f8
```

> 把 `a3f8` 换成你收到的 key。下载完文件就自动从服务器删除了。

### 健康检查

浏览器直接访问 `https://upload.你的用户名.workers.dev/health`，不需要密码。

---

## 常见问题

### 怎么改密码？

去 KV 命名空间 → 找到键名 `API_KEY` → 把值改成新密码就行。

### 怎么添加多个密码？

目前版本只支持一个密码（键名 `API_KEY` 对应一个值）。如果需要多密码，在 KV 里再加一条 `API_KEY_2`、`API_KEY_3` 等，但需要改代码才能支持。

### 文件上传失败？

- 检查文件大小不超过 100MB
- 检查密码是否正确（`Authorization: Bearer 你的密码`）
- 访问 `/health` 确认服务在运行

### 下载提示"File not found"？

- 每个文件只能下载一次，下载后就删了
- 文件超过 24 小时也会自动过期删除

---

## 项目结构（供开发者参考）

```
worker.js          ← 网页部署用的单文件（只需要这个）
src/
├── index.ts       # Worker 入口 & 路由
├── auth.ts        # API Key 认证
├── upload.ts      # 上传处理
├── download.ts    # 下载处理
├── cleanup.ts     # 定时清理过期文件
└── types.ts       # TypeScript 类型定义
schema.sql         # D1 建表语句
wrangler.toml      # Cloudflare 配置（终端部署用）
package.json       # Node.js 依赖（终端部署用）
```

> 如果你熟悉终端和 Node.js，也可以用传统方式部署：`npm install` → 修改 `wrangler.toml` 里的 ID → `npm run deploy`。

---

## 技术栈

| 组件 | 用途 | Cloudflare 服务 | 免费额度 |
|------|------|----------------|---------|
| API 服务 | 路由处理 | Workers | 每天 10 万次请求 |
| 文件存储 | 存文件本体 | R2 | 10GB 存储 |
| 元数据 | 存文件记录 | D1 (SQLite) | 5GB 存储 |
| 密码验证 | 认证 | KV | 每天 10 万次读取 |
| 定时清理 | 清过期文件 | Cron Triggers | 免费 |

## License

MIT
