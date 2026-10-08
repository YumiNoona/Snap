// Check desktop entry points and tests for orphaned modules without loading the website.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(tsx?|css)$/.test(file)) files.push(file);
  }
}
walk("src");
const edges = new Map();
const missing = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const imports = [];
  if (!file.endsWith(".css")) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  edges.set(file, imports.filter(specifier => specifier.startsWith(".")).flatMap(specifier => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(candidate => files.includes(candidate));
    if (resolved) return [resolved];
    if (!fs.existsSync(path.join(root, base))) missing.push(`${file}: ${specifier}`);
    return [];
  }));
}
const reachable = new Set();
function visit(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const dependency of edges.get(file) ?? []) visit(dependency);
}
const entries = files.filter(file => file === "src/main.tsx" || /\.test\.tsx?$/.test(file) || file.endsWith(".d.ts"));
entries.forEach(visit);
const unused = files.filter(file => !reachable.has(file));
for (const file of unused) console.error(`Unreachable source: ${file}`);
for (const reference of missing) console.error(`Missing import: ${reference}`);
console.log(`Checked ${files.length} source files from ${entries.length} entry points; ${unused.length} orphaned files, ${missing.length} missing imports.`);
if (unused.length || missing.length) process.exitCode = 1;
