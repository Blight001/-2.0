const fs = require('fs');
const path = require('path');

const templateDir = path.join(process.cwd(), 'src/ui/templates');
const files = fs.readdirSync(templateDir).filter((file) => file.endsWith('.js'));

for (const file of files) {
  const fullPath = path.join(templateDir, file);
  const source = fs.readFileSync(fullPath, 'utf8');
  const match = source.match(/return\s+("([\s\S]*?)");\r?\n\};\s*$/);

  if (!match) {
    continue;
  }

  let html = '';
  try {
    html = eval(match[1]); // eslint-disable-line no-eval
  } catch (error) {
    throw new Error(`无法解析模板文件: ${file}: ${error.message}`);
  }

  const formatted = [
    source.slice(0, match.index),
    'return `',
    html.replace(/`/g, '\\`'),
    '`;\n};\n'
  ].join('');

  fs.writeFileSync(fullPath, formatted, 'utf8');
}

console.log(`Formatted ${files.length} template file(s).`);
