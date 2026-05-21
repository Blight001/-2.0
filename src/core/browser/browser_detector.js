const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// 浏览器检测工具函数
async function findChromiumBasedBrowser() {
  /**
   * 查找本机已安装的 Chromium 内核浏览器（Chrome 或 Edge）。
   * 优先顺序：
   * 1) 环境变量 BROWSER_PATH / CHROME_PATH / EDGE_PATH
   * 2) 自定义常见路径（Windows下的一些默认安装路径）
   * 3) 系统搜索（Windows下使用PowerShell递归搜索）
   * 找到即返回绝对路径，否则返回 null。
   */
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { spawn } = require('child_process');

  let chromePath = null;
  let edgePath = null;

  // 1. 首先检查环境变量（允许 BROWSER_PATH 单独指定）
  const envChrome = process.env.BROWSER_PATH || process.env.CHROME_PATH;
  const envEdge = process.env.EDGE_PATH;
  if (envChrome && fs.existsSync(envChrome)) {
    chromePath = envChrome;
  }
  if (envEdge && fs.existsSync(envEdge)) {
    edgePath = envEdge;
  }

  // 2.1 自定义常见路径（兼容非默认安装盘，例如 D:\Google\Chrome）
  const customCandidates = [];
  if (os.platform() === 'win32') {
    // Windows 系统下的常见安装路径
    const drives = ['C:', 'D:', 'E:', 'F:', 'G:']; // 常见的驱动器盘符
    const chromePaths = [
      '\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      '\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '\\Google\\Chrome\\Application\\chrome.exe',
      '\\Chrome\\Application\\chrome.exe'
    ];
    const edgePaths = [
      '\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      '\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      '\\Microsoft\\Edge\\Application\\msedge.exe',
      '\\Edge\\Application\\msedge.exe'
    ];

    // 生成所有可能的组合
    drives.forEach(drive => {
      chromePaths.forEach(path => customCandidates.push(drive + path));
      edgePaths.forEach(path => customCandidates.push(drive + path));
    });

    // 添加一些特殊的用户目录路径
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    if (userProfile) {
      customCandidates.push(
        path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }

  } else if (os.platform() === 'darwin') {
    // macOS 路径
    customCandidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    );
  } else {
    // Linux 路径
    customCandidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge-stable',
      '/usr/bin/chromium',
      '/opt/google/chrome/chrome',
      '/snap/bin/chromium',
      '/snap/bin/chromium-browser'
    );

    // 添加用户本地安装路径
    const userHome = process.env.HOME || '';
    if (userHome) {
      customCandidates.push(
        path.join(userHome, '.local', 'bin', 'google-chrome'),
        path.join(userHome, '.local', 'bin', 'chromium-browser'),
        path.join(userHome, 'bin', 'google-chrome'),
        path.join(userHome, 'bin', 'chromium-browser')
      );
    }
  }

  for (const candidate of customCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      if (candidate.toLowerCase().includes('chrome')) {
        chromePath = candidate;
      } else if (candidate.toLowerCase().includes('edge')) {
        edgePath = candidate;
      }
      break;
    }
  }

  if (chromePath && fs.existsSync(chromePath)) {
    console.log(`[浏览器检测] 找到 Chrome: ${chromePath}`);
    return chromePath;
  }
  if (edgePath && fs.existsSync(edgePath)) {
    console.log(`[浏览器检测] 找到 Edge: ${edgePath}`);
    return edgePath;
  }

  // 3. 使用系统搜索作为最终兜底（仅Windows）
  if (os.platform() === 'win32') {
    try {
      const runPowerShellSearch = (exeName) => {
        return new Promise((resolve) => {
          try {
            const { spawn } = require('child_process');
            const psScript = `
              $drives = Get-PSDrive -PSProvider 'FileSystem' | Where-Object { $_.Free -gt 0 } | Select-Object -ExpandProperty Root;
              $result = $null;
              foreach ($d in $drives) {
                try {
                  $p = Get-ChildItem -Path $d -Recurse -Filter '${exeName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1;
                  if ($p) { $result = $p; break }
                } catch {}
              }
              if ($result) { $result }
            `;

            const child = spawn('powershell', ['-NoProfile', '-Command', psScript], {
              stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
              stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
              stderr += data.toString();
            });

            child.on('close', (code) => {
              if (code === 0 && stdout.trim()) {
                const foundPath = stdout.trim().split('\n')[0].trim().replace(/"/g, '');
                if (foundPath && fs.existsSync(foundPath)) {
                  resolve(foundPath);
                } else {
                  resolve(null);
                }
              } else {
                console.log(`[浏览器检测] PowerShell 搜索 ${exeName} 失败:`, stderr);
                resolve(null);
              }
            });

            child.on('error', () => {
              resolve(null);
            });

            // 30秒超时
            setTimeout(() => {
              try { child.kill(); } catch {}
              resolve(null);
            }, 30000);

          } catch (e) {
            resolve(null);
          }
        });
      };

      // 并行搜索 Chrome 和 Edge
      const searchPromises = [
        runPowerShellSearch('chrome.exe'),
        runPowerShellSearch('msedge.exe')
      ];

      const [foundChrome, foundEdge] = await Promise.all(searchPromises);

      if (foundChrome) chromePath = foundChrome;
      if (foundEdge) edgePath = foundEdge;

    } catch (e) {
      console.log('[浏览器检测] 系统搜索失败:', e.message);
    }
  }

  // 优先返回 Chrome，其次 Edge
  if (chromePath && fs.existsSync(chromePath)) {
    console.log(`[浏览器检测] 最终选择 Chrome: ${chromePath}`);
    return chromePath;
  }
  if (edgePath && fs.existsSync(edgePath)) {
    console.log(`[浏览器检测] 最终选择 Edge: ${edgePath}`);
    return edgePath;
  }

  console.log('[浏览器检测] 未找到任何可用的浏览器');
  return null;
}

// 检测所有类型浏览器
async function detectAllBrowsers() {
  /**
   * 检测系统中安装的所有浏览器类型
   * 返回格式: [{ name: 'Chrome', type: 'chromium', path: '/path/to/chrome.exe' }, ...]
   */
  const detectedBrowsers = [];

  try {
    // 检测 Chromium-based 浏览器 (Chrome, Edge)
    // 分别检测 Chrome 和 Edge，而不是使用 findChromiumBasedBrowser
    const chromePath = await findBrowserByName('chrome');
    const edgePath = await findBrowserByName('edge');

    if (chromePath) {
      detectedBrowsers.push({
        name: 'Chrome',
        type: 'chrome',
        path: chromePath
      });
    }
    
    if (edgePath) {
      detectedBrowsers.push({
        name: 'Edge',
        type: 'edge',
        path: edgePath
      });
    }

    // 检测 Firefox
    const firefoxPaths = [];
    if (os.platform() === 'win32') {
      const drives = ['C:', 'D:', 'E:', 'F:', 'G:'];
      drives.forEach(drive => {
        firefoxPaths.push(
          `${drive}\\Program Files\\Mozilla Firefox\\firefox.exe`,
          `${drive}\\Program Files (x86)\\Mozilla Firefox\\firefox.exe`,
          `${drive}\\Mozilla Firefox\\firefox.exe`
        );
      });
      // 用户目录
      const userProfile = process.env.USERPROFILE || '';
      if (userProfile) {
        firefoxPaths.push(path.join(userProfile, 'AppData', 'Local', 'Mozilla Firefox', 'firefox.exe'));
      }
    } else if (os.platform() === 'darwin') {
      firefoxPaths.push('/Applications/Firefox.app/Contents/MacOS/firefox');
    } else {
      firefoxPaths.push(
        '/usr/bin/firefox',
        '/usr/bin/firefox-esr',
        '/snap/bin/firefox',
        '/opt/firefox/firefox'
      );
    }

    for (const firefoxPath of firefoxPaths) {
      if (fs.existsSync(firefoxPath)) {
        detectedBrowsers.push({
          name: 'Firefox',
          type: 'firefox',
          path: firefoxPath
        });
        break;
      }
    }

    // 检测 Safari (仅 macOS)
    if (os.platform() === 'darwin') {
      const safariPath = '/Applications/Safari.app/Contents/MacOS/Safari';
      if (fs.existsSync(safariPath)) {
        detectedBrowsers.push({
          name: 'Safari',
          type: 'webkit',
          path: safariPath
        });
      }
    }

  } catch (error) {
    console.log('[浏览器检测] 检测过程中出错:', error.message);
  }

  return detectedBrowsers;
}

// 检测特定名称的浏览器
async function findBrowserByName(browserName) {
  /**
   * 检测特定名称的浏览器 (chrome 或 edge)
   */
  let browserPath = null;

  // 1. 首先检查环境变量
  const envVar = browserName.toUpperCase() + '_PATH';
  if (process.env[envVar] && fs.existsSync(process.env[envVar])) {
    browserPath = process.env[envVar];
  }

  // 2. 自定义常见路径
  if (!browserPath) {
    const customCandidates = [];
    if (os.platform() === 'win32') {
      const drives = ['C:', 'D:', 'E:', 'F:', 'G:'];
      let paths = [];

      if (browserName === 'chrome') {
        paths = [
          '\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          '\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          '\\Google\\Chrome\\Application\\chrome.exe',
          '\\Chrome\\Application\\chrome.exe'
        ];
      } else if (browserName === 'edge') {
        paths = [
          '\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          '\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          '\\Microsoft\\Edge\\Application\\msedge.exe',
          '\\Edge\\Application\\msedge.exe'
        ];
      }

      drives.forEach(drive => {
        paths.forEach(path => customCandidates.push(drive + path));
      });

      // 用户目录路径
      const userProfile = process.env.USERPROFILE || '';
      if (userProfile) {
        if (browserName === 'chrome') {
          customCandidates.push(path.join(userProfile, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'));
        } else if (browserName === 'edge') {
          customCandidates.push(path.join(userProfile, 'AppData', 'Local', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
        }
      }
    }

    for (const candidate of customCandidates) {
      if (candidate && fs.existsSync(candidate)) {
        browserPath = candidate;
        break;
      }
    }
  }

  // 3. 系统搜索 (仅Windows)
  if (!browserPath && os.platform() === 'win32') {
    try {
      const exeName = browserName === 'chrome' ? 'chrome.exe' : 'msedge.exe';
      const runPowerShellSearch = (exeName) => {
        return new Promise((resolve) => {
          try {
            const { spawn } = require('child_process');
            const psScript = `
              $drives = Get-PSDrive -PSProvider 'FileSystem' | Where-Object { $_.Free -gt 0 } | Select-Object -ExpandProperty Root;
              $result = $null;
              foreach ($d in $drives) {
                try {
                  $p = Get-ChildItem -Path $d -Recurse -Filter '${exeName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1;
                  if ($p) { $result = $p; break }
                } catch {}
              }
              if ($result) { $result }
            `;

            const child = spawn('powershell', ['-NoProfile', '-Command', psScript], {
              stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            child.stdout.on('data', (data) => {
              stdout += data.toString();
            });

            child.on('close', (code) => {
              if (code === 0 && stdout.trim()) {
                const foundPath = stdout.trim().split('\n')[0].trim().replace(/"/g, '');
                if (foundPath && fs.existsSync(foundPath)) {
                  resolve(foundPath);
                } else {
                  resolve(null);
                }
              } else {
                resolve(null);
              }
            });

            child.on('error', () => {
              resolve(null);
            });

            // 30秒超时
            setTimeout(() => {
              try { child.kill(); } catch {}
              resolve(null);
            }, 30000);
          } catch (e) {
            resolve(null);
          }
        });
      };

      browserPath = await runPowerShellSearch(exeName);
    } catch (e) {
      console.log(`[浏览器检测] ${browserName} 系统搜索失败:`, e.message);
    }
  }

  if (browserPath && fs.existsSync(browserPath)) {
    console.log(`[浏览器检测] 找到 ${browserName}: ${browserPath}`);
    return browserPath;
  }

  console.log(`[浏览器检测] 未找到 ${browserName}`);
  return null;
}

module.exports = { findChromiumBasedBrowser, detectAllBrowsers, findBrowserByName };
