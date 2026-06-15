const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('./src');

const colors = ["teal", "emerald", "red", "amber", "yellow", "green", "indigo", "purple"];
let addColors = [];
colors.forEach(c => {
  addColors.push({ p: new RegExp(`(?<!dark:)text-${c}-400`, 'g'), r: `text-${c}-600 dark:text-${c}-400` });
});

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  addColors.forEach(({ p, r }) => {
    content = content.replace(p, r);
  });
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated colors ${file}`);
  }
});
