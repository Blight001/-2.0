# AI账号注册器 2.0 (AI Account Register 2.0)

[English](README.md) | [中文](README_zh-CN.md)

---

## 🇨🇳 中文

### 简介
**AI账号注册器 2.0** 是一款基于 Electron 的强大桌面应用程序，专为自动化注册各种 AI 平台账号而设计。它采用灵活的“卡片”系统来定义注册流程，使其易于扩展以支持新的服务。

### 主要功能
- **自动化注册**：全自动的注册流程，包括表单填写、点击和页面跳转。
- **邮箱验证**：内置邮箱验证码处理支持。
- **灵活的“卡片”系统**：注册逻辑定义在 JSON 格式的“卡片”中（位于 `resource/register_cards/` 目录），无需修改核心代码即可轻松更新或添加新服务。
- **代理支持**：集成 Clash 代理管理，确保网络稳定性和 IP 轮换。
- **Cookie 管理**：注册成功后自动保存和管理会话 Cookie。
- **浏览器自动化**：使用 Playwright 进行强大的浏览器自动化操作，并具备反检测能力。
- **用户界面**：简洁直观的 Electron 界面，用于监控进度和管理任务。

### 环境要求
- Node.js (建议 v16 或更高版本)
- npm 或 yarn

### 安装步骤

1. 克隆仓库：
   ```bash
   git clone <repository-url>
   cd Electron
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

### 配置说明

#### 1. 用户配置
在 `resource/config.json` 路径下创建配置文件（如果不存在）。此文件包含您的服务器和认证设置。
**注意：** 此文件包含敏感信息，已被 git 忽略。

示例结构：
```json
{
    "server_url": "您的服务器地址",
    "passphrase": "您的密钥",
    "auth_token": "您的认证令牌",
    "aid": "您的ID",
    "score": "0"
}
```

#### 2. 注册卡片
注册流程定义在 `resource/register_cards/` 目录中。每个 `.json` 文件代表一个注册目标（例如 `resource/register_cards/即梦注册卡片.json`）。您可以修改现有卡片或创建新卡片以支持其他网站。

### 使用方法

#### 开发模式
在开发模式下启动应用程序（支持热重载）：
```bash
npm run dev
```

#### 生产构建
为您的操作系统（如 Windows）构建应用程序：
```bash
npm run build
# 或
npm run dist
```
构建产物将位于 `dist/` 目录中。

#### 分版本打包
- 软件版：`npm run dist:app`
- 网页版：`npm run dist:web`
- 如果在 PowerShell 当前目录直接运行 `.bat`，需要写成 `.\build-app.bat`

#### 分版本启动
- 软件版：`run-app.bat`
- 网页版（无控制台）：`run-web.vbs`
- 网页版（调试控制台）：`run-web.bat`

### 项目结构
- `src/core/app/`: Electron 启动与窗口引导
- `src/core/browser/`: 浏览器识别和浏览器参数辅助
- `src/core/card/`: 卡片加载与存储管理
- `src/core/clash/`: Clash 代理集成
- `src/core/cookie/`: Cookie 持久化与测试
- `src/core/email/`: 邮件客户端与默认配置
- `src/core/haika/`: 海卡状态与存储
- `src/core/infra/`: 通用基础设施工具
- `src/core/ipc/`: Electron IPC 处理器
- `src/core/registration/`: TCP / MQTT 注册桥接
- `src/core/registration-thread/`: 注册流程执行引擎
- `src/core/runtime/`: 运行时编排
- `src/core/web/`: 网页控制台服务与打包器
- `src/ui/`: 前端源代码（HTML, CSS, JS）
- `resource/register_cards/`: 注册流程的 JSON 配置文件
- `cookies/`: 存储注册成功后的会话 Cookie
- `backup/`: 备份数据
- `dist/`: 构建产物

### 许可证 / License
MIT
