import { Marked } from 'marked';
import { buildWsDocs } from './ws-docs.js';

export const WS_DOCS_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const STYLE = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1a1f27; --muted: #5b6573; --line: #d9dee5; --soft: #f3f5f8; --accent: #b45309; --code-bg: #0f141a; --code-fg: #e6edf3; }
@media (prefers-color-scheme: dark) { :root { --bg: #0b0d10; --fg: #f0f3f7; --muted: #9aa5b4; --line: #2d3643; --soft: #151a21; --accent: #ffd166; --code-bg: #151a21; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.65 system-ui, -apple-system, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 40px 24px 96px; }
h1 { font-size: 36px; line-height: 1.2; margin: 0 0 8px; }
h2 { font-size: 26px; margin: 56px 0 12px; padding-top: 24px; border-top: 1px solid var(--line); color: var(--accent); }
h3 { font-size: 20px; margin: 32px 0 8px; }
p, li { max-width: 72ch; }
li { margin: 4px 0; }
a { color: var(--accent); }
code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
:not(pre) > code { background: var(--soft); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; white-space: nowrap; }
pre { background: var(--code-bg); color: var(--code-fg); border-radius: 10px; padding: 16px 20px; overflow-x: auto; line-height: 1.5; }
pre code { background: none; border: 0; padding: 0; white-space: pre; font-size: 14.5px; }
.table-wrap { overflow-x: auto; margin: 16px 0; border: 1px solid var(--line); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-size: 15.5px; }
th, td { text-align: left; vertical-align: top; padding: 10px 14px; border-bottom: 1px solid var(--line); }
th { background: var(--soft); font-weight: 650; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td:first-child { white-space: nowrap; }
td code { white-space: normal; }
strong { font-weight: 650; }
@media (max-width: 600px) { main { padding: 24px 16px 64px; } h1 { font-size: 28px; } }
`;

export function buildWsDocsHtml(): string {
  const marked = new Marked({
    renderer: {
      table(token) {
        const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const rows = token.rows
          .map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`)
          .join('');
        return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });
  const body = marked.parse(buildWsDocs(), { async: false });
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drops API : le WebSocket</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
