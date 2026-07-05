# AI Automation 2.0 (AI 自动化工具 2.0)

[English](README.md) | [中文](README_zh-CN.md)

---

## 🇬🇧 English

### Introduction
**AI Automation 2.0** is a powerful Electron-based desktop application designed for general automation workflows on various AI platforms. It utilizes a flexible "Card" system to define automation task flows, making it easy to extend support for new services.

### Features
- **Automated Workflows**: Fully automated task execution including form filling, clicking, and navigation.
- **Email Verification**: Built-in support for handling email verification codes (integrated with temporary email services).
- **Flexible "Card" System**: Automation logic is defined in JSON "Cards" (`resource/automation_cards/` directory), allowing easy updates and additions without changing core code.
- **Proxy Support**: Integrated Clash proxy management for network stability and IP rotation.
- **Cookie Management**: Automatic saving and management of session cookies after successful execution.
- **Browser Automation**: Uses Playwright for robust browser automation and detection avoidance.
- **User Interface**: Clean and intuitive Electron-based UI for monitoring progress and managing tasks.

### Prerequisites
- Node.js (v16 or higher recommended)
- npm or yarn

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd Electron
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Configuration

#### 1. User Configuration
Create a `resource/config.json` file (if not present). This file contains your server and authentication settings.
**Note:** This file is sensitive and is ignored by git.

Example structure:
```json
{
    "server_url": "YOUR_SERVER_URL",
    "passphrase": "YOUR_PASSPHRASE",
    "auth_token": "YOUR_AUTH_TOKEN",
    "aid": "YOUR_AID",
    "score": "0"
}
```

#### 2. Automation Cards
Automation workflows are defined in the `resource/automation_cards/` directory. Each `.json` file represents an automation target (e.g., `resource/automation_cards/即梦自动化卡片.json`). You can modify existing cards or create new ones to support other websites.

### Usage

#### Development Mode
To start the application in development mode with hot-reloading:
```bash
npm run dev
```

#### Production Build
To build the application for your operating system (e.g., Windows):
```bash
npm run build
# or
npm run dist
```
The output will be in the `dist/` directory.

#### Split Builds
- Desktop app: `npm run dist:app`
- Web variant: `npm run dist:web`

#### Split Launchers
- Desktop app: `run-app.bat`
- Web variant without console: `run-web.vbs`
- Web variant with console: `run-web.bat`

### Project Structure
- `src/core/app/`: Electron startup and window bootstrap
- `src/core/browser/`: Browser detection and browser profile helpers
- `src/core/card/`: Card loading and storage management
- `src/core/clash/`: Clash proxy integration
- `src/core/cookie/`: Cookie persistence and testing
- `src/core/email/`: Email client and defaults
- `src/core/haika/`: Haika state and storage
- `src/core/infra/`: Shared infrastructure helpers
- `src/core/ipc/`: Electron IPC handlers
- `src/core/execution/`: TCP/MQTT control bridge
- `src/core/execution-thread/`: Automation workflow engine
- `src/core/runtime/`: Runtime orchestration
- `src/core/web/`: Web UI server and bundler
- `src/ui/`: Frontend source code (HTML, CSS, JS)
- `resource/automation_cards/`: JSON configuration files for automation workflows
- `cookies/`: Stores session cookies from successful automation runs
- `backup/`: Backup data
- `dist/`: Build artifacts

### License
MIT
