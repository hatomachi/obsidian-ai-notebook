/**
 * Confluence Storage Format (XHTML) および View HTML を Obsidian 向け Markdown に変換
 */

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

export function confluenceHtmlToMarkdown(html: string): string {
    if (!html || !html.trim()) return '';

    let content = html;

    // 1. CDATA 保持しながらマクロの置換
    // Code Macro: <ac:structured-macro ac:name="code">...<ac:plain-text-body><![CDATA[...]]></ac:plain-text-body></ac:structured-macro>
    content = content.replace(
        /<ac:structured-macro[^>]*ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
        (match, body) => {
            const langMatch = body.match(/<ac:parameter[^>]*ac:name="language"[^>]*>([^<]+)<\/ac:parameter>/i);
            const lang = langMatch ? langMatch[1].trim() : '';
            const codeMatch = body.match(/<ac:plain-text-body>[\s\r\n]*<!\[CDATA\[([\s\S]*?)\]\]>[\s\r\n]*<\/ac:plain-text-body>/i)
                || body.match(/<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/i);
            const rawCode = codeMatch ? codeMatch[1] : '';
            return `\n\n\`\`\`${lang}\n${rawCode.trim()}\n\`\`\`\n\n`;
        }
    );

    // Callout Macros: info, tip, warning, note
    const calloutMap: Record<string, string> = {
        info: 'NOTE',
        note: 'NOTE',
        tip: 'TIP',
        warning: 'WARNING'
    };

    content = content.replace(
        /<ac:structured-macro[^>]*ac:name="(info|tip|warning|note)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
        (match, macroName, body) => {
            const calloutType = calloutMap[macroName.toLowerCase()] || 'NOTE';
            // inner body からテキスト抽出
            const innerMatch = body.match(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i);
            const innerHtml = innerMatch ? innerMatch[1] : body;
            const innerMd = confluenceHtmlToMarkdown(innerHtml).trim();
            const lines = innerMd.split('\n').map((l: string) => `> ${l}`);
            return `\n\n> [!${calloutType}]\n${lines.join('\n')}\n\n`;
        }
    );

    // Status Macro: <ac:structured-macro ac:name="status">...<ac:parameter ac:name="title">xxx</ac:parameter>...
    content = content.replace(
        /<ac:structured-macro[^>]*ac:name="status"[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
        (match, body) => {
            const titleMatch = body.match(/<ac:parameter[^>]*ac:name="title"[^>]*>([^<]+)<\/ac:parameter>/i);
            const title = titleMatch ? titleMatch[1].trim() : 'STATUS';
            return `\`[${title}]\``;
        }
    );

    // Confluence Internal Link: <ac:link><ri:page ri:content-title="Title" /><ac:plain-text-link-body><![CDATA[Label]]></ac:plain-text-link-body></ac:link>
    content = content.replace(
        /<ac:link>([\s\S]*?)<\/ac:link>/gi,
        (match, body) => {
            const pageMatch = body.match(/<ri:page[^>]*ri:content-title="([^"]+)"/i);
            const labelMatch = body.match(/<ac:plain-text-link-body>[\s\r\n]*<!\[CDATA\[([\s\S]*?)\]\]>[\s\r\n]*<\/ac:plain-text-link-body>/i)
                || body.match(/<ac:link-body>([\s\S]*?)<\/ac:link-body>/i);
            
            const pageTitle = pageMatch ? pageMatch[1] : '';
            const label = labelMatch ? labelMatch[1].trim() : '';

            if (pageTitle && label && pageTitle !== label) {
                return `[[${pageTitle}|${label}]]`;
            } else if (pageTitle) {
                return `[[${pageTitle}]]`;
            } else if (label) {
                return label;
            }
            return '';
        }
    );

    // 2. HTML テーブルのパース
    content = content.replace(
        /<table[^>]*>([\s\S]*?)<\/table>/gi,
        (match, tableBody) => {
            return parseHtmlTableToMarkdown(tableBody);
        }
    );

    // 3. 標準 HTML タグの変換
    // <pre><code>...</code></pre>
    content = content.replace(
        /<pre><code(?:\s+class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/gi,
        (match, lang, code) => {
            return `\n\n\`\`\`${lang || ''}\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n\n`;
        }
    );

    // 見出し <h1> 〜 <h6>
    content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n\n# ${cleanInline(text)}\n\n`);
    content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n\n## ${cleanInline(text)}\n\n`);
    content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n\n### ${cleanInline(text)}\n\n`);
    content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n\n#### ${cleanInline(text)}\n\n`);
    content = content.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `\n\n##### ${cleanInline(text)}\n\n`);
    content = content.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, text) => `\n\n###### ${cleanInline(text)}\n\n`);

    // リスト <ul> / <ol>
    content = content.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, listBody) => {
        const items = extractListItems(listBody, '- ');
        return `\n\n${items.join('\n')}\n\n`;
    });

    content = content.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, listBody) => {
        const items = extractListItems(listBody, '1. ');
        return `\n\n${items.join('\n')}\n\n`;
    });

    // 段落・改行
    content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n\n${cleanInline(text)}\n\n`);
    content = content.replace(/<br\s*\/?>/gi, '\n');
    content = content.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

    // 引用 <blockquote>
    content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
        const inner = cleanInline(text).trim();
        const lines = inner.split('\n').map((l: string) => `> ${l}`);
        return `\n\n${lines.join('\n')}\n\n`;
    });

    // リンク <a href="...">text</a>
    content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
        const cleanText = cleanInline(text).trim() || href;
        return `[${cleanText}](${href})`;
    });

    // インライン装飾
    content = content.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, t) => `**${cleanInline(t)}**`);
    content = content.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, t) => `*${cleanInline(t)}*`);
    content = content.replace(/<(?:del|s|strike)[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/gi, (_, t) => `~~${cleanInline(t)}~~`);
    content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${decodeHtmlEntities(t)}\``);

    // 残りのHTMLタグの除去
    content = content.replace(/<[^>]+>/g, '');

    // 全体デコード & 余剰改行の正規化
    content = decodeHtmlEntities(content);
    content = content.replace(/\n{3,}/g, '\n\n');

    return content.trim();
}

function cleanInline(text: string): string {
    return text
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${decodeHtmlEntities(t)}\``)
        .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, t) => `**${cleanInline(t)}**`)
        .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, t) => `*${cleanInline(t)}*`)
        .replace(/<(?:del|s|strike)[^>]*>([\s\S]*?)<\/(?:del|s|strike)>/gi, (_, t) => `~~${cleanInline(t)}~~`)
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => `[${cleanInline(t).trim() || href}](${href})`)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function extractListItems(listHtml: string, prefix: string): string[] {
    const items: string[] = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    let index = 1;
    while ((match = liRegex.exec(listHtml)) !== null) {
        const itemText = cleanInline(match[1]).trim();
        const currentPrefix = prefix === '1. ' ? `${index++}. ` : prefix;
        items.push(`${currentPrefix}${itemText}`);
    }
    return items;
}

function parseHtmlTableToMarkdown(tableHtml: string): string {
    const rows: string[][] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;

    while ((trMatch = trRegex.exec(tableHtml)) !== null) {
        const rowContent = trMatch[1];
        const cells: string[] = [];
        const cellRegex = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const cellText = cleanInline(cellMatch[1]).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim();
            cells.push(cellText);
        }

        if (cells.length > 0) {
            rows.push(cells);
        }
    }

    if (rows.length === 0) return '';

    // 列数の最大値を求める
    const colCount = Math.max(...rows.map(r => r.length));
    if (colCount === 0) return '';

    // 正規化 (各行の列数を揃える)
    for (const r of rows) {
        while (r.length < colCount) {
            r.push('');
        }
    }

    const header = rows[0];
    const dataRows = rows.slice(1);

    let md = `\n\n| ${header.join(' | ')} |\n`;
    md += `| ${header.map(() => ':---').join(' | ')} |\n`;

    for (const r of dataRows) {
        md += `| ${r.join(' | ')} |\n`;
    }
    md += '\n';

    return md;
}
