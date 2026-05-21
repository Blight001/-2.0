const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, 'src/ui/styles.css');
const targetDir = path.join(projectRoot, 'src/ui/styles');

const source = fs.readFileSync(sourcePath, 'utf8');

function sliceByMarker(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Missing start marker: ${startMarker}`);
  }

  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  if (end === -1) {
    throw new Error(`Missing end marker: ${endMarker}`);
  }

  return source.slice(start, end).trimStart();
}

fs.mkdirSync(targetDir, { recursive: true });

const baseEndMarker = '/* 控制台面板 */';
const panelsEndMarker = '/* 对话框样式 */';
const dialogsEndMarker = '/* 左侧选项卡样式（模仿 Qt Tab 风格） */';
const tabsEndMarker = '/* 加载状态 */';

const chunks = [
  ['base.css', source.slice(0, source.indexOf(baseEndMarker)).trimEnd()],
  ['panels.css', sliceByMarker(baseEndMarker, panelsEndMarker)],
  ['dialogs.css', sliceByMarker(panelsEndMarker, dialogsEndMarker)],
  ['tabs.css', sliceByMarker(dialogsEndMarker, tabsEndMarker)],
  ['utilities.css', sliceByMarker(tabsEndMarker)]
];

for (const [name, content] of chunks) {
  fs.writeFileSync(path.join(targetDir, name), `${content}\n`, 'utf8');
}

fs.writeFileSync(
  sourcePath,
  [
    "@import url('./styles/base.css');",
    "@import url('./styles/panels.css');",
    "@import url('./styles/dialogs.css');",
    "@import url('./styles/tabs.css');",
    "@import url('./styles/utilities.css');",
    ''
  ].join('\n'),
  'utf8'
);

console.log('UI styles split completed.');
