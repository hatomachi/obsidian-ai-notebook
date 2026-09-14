/**
 * Confluence CLI Helper Template
 * ノートブックの .tools/confluence.cjs に配備されるスクリプトのテンプレート文字列を提供
 */

export function getConfluenceHelperScript(): string {
    return `#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 1. 設定読み込み
const configPath = path.join(__dirname, 'confluence-config.json');
let config = {};
if (fs.existsSync(configPath)) {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
        console.error('Error reading confluence-config.json:', e.message);
    }
}

function checkConfig() {
    if (!config.baseUrl) {
        console.error('❌ Confluence baseUrl is not configured in .tools/confluence-config.json');
        console.error('Please configure Confluence server in Obsidian AI Notebook settings.');
        process.exit(1);
    }
}

// URL 結合ヘルパー（baseUrl のパスプレフィックスを維持し、先頭スラッシュによる破棄を防止）
function resolveConfluenceUrl(endpoint, baseUrl) {
    if (!endpoint) return new url.URL(baseUrl);
    if (/^https?:\\/\\//i.test(endpoint)) return new url.URL(endpoint);
    const base = baseUrl.replace(/\\/+$/, '') + '/';
    const parsedBase = new url.URL(base);
    const basePath = parsedBase.pathname.replace(/^\\/|\\/$/g, '');
    let relative = endpoint.replace(/^\\/+/, '');
    if (basePath && (relative === basePath || relative.startsWith(basePath + '/'))) {
        relative = relative.substring(basePath.length).replace(/^\\/+/, '');
    }
    return new url.URL(relative, base);
}

// 2. HTTP / REST API リクエスト関数
function apiRequest(endpoint) {
    return new Promise((resolve, reject) => {
        const fullUrl = resolveConfluenceUrl(endpoint, config.baseUrl);
        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'Obsidian-AI-Notebook-CLI/1.0'
        };

        if (config.authType === 'basic' && config.token) {
            const user = config.username || '';
            const creds = Buffer.from(\`\${user}:\${config.token}\`).toString('base64');
            headers['Authorization'] = \`Basic \${creds}\`;
        } else if (config.token) {
            headers['Authorization'] = \`Bearer \${config.token}\`;
        }

        const options = {
            hostname: fullUrl.hostname === 'localhost' ? '127.0.0.1' : fullUrl.hostname,
            port: fullUrl.port || (isHttps ? 443 : 80),
            path: fullUrl.pathname + fullUrl.search,
            method: 'GET',
            headers
        };

        if (isHttps && config.insecureSsl) {
            options.rejectUnauthorized = false;
        }

        const req = client.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(\`HTTP \${res.statusCode}: \${data || res.statusMessage}\`));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

// 2.5 バイナリファイル（画像等）ダウンロード関数
function downloadFile(endpointOrUrl, destPath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects'));
        }
        const fullUrl = resolveConfluenceUrl(endpointOrUrl, config.baseUrl);
        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers = {
            'User-Agent': 'Obsidian-AI-Notebook-CLI/1.0'
        };

        if (config.authType === 'basic' && config.token) {
            const user = config.username || '';
            const creds = Buffer.from(\`\${user}:\${config.token}\`).toString('base64');
            headers['Authorization'] = \`Basic \${creds}\`;
        } else if (config.token) {
            headers['Authorization'] = \`Bearer \${config.token}\`;
        }

        const options = {
            hostname: fullUrl.hostname === 'localhost' ? '127.0.0.1' : fullUrl.hostname,
            port: fullUrl.port || (isHttps ? 443 : 80),
            path: fullUrl.pathname + fullUrl.search,
            method: 'GET',
            headers
        };

        if (isHttps && config.insecureSsl) {
            options.rejectUnauthorized = false;
        }

        const req = client.request(options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(downloadFile(res.headers.location, destPath, maxRedirects - 1));
            }

            if (res.statusCode >= 200 && res.statusCode < 300) {
                const fileStream = fs.createWriteStream(destPath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    resolve();
                });
                fileStream.on('error', (err) => {
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
            } else {
                res.resume();
                reject(new Error(\`HTTP \${res.statusCode}: \${res.statusMessage}\`));
            }
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

// 3. HINTS.md の簡易パース
function parseHintsFile(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const match = content.match(/^---\\r?\\n([\\s\\S]*?)(?:\\r?\\n)?---(?:\\r?\\n|$)/);
        if (!match) return [];
        const yamlText = match[1];
        
        // 簡易YAMLパース (hints 配列の抽出)
        const hints = [];
        const lines = yamlText.split('\\n');
        let currentHint = null;
        let inKeywords = false;

        for (let line of lines) {
            line = line.trimEnd();
            const trimmed = line.trim();
            if (trimmed.startsWith('- id:') || trimmed === '-' || (trimmed.startsWith('-') && !inKeywords)) {
                if (currentHint) hints.push(currentHint);
                currentHint = { keywords: [] };
                inKeywords = false;
                const m = trimmed.match(/^- id:\\s*(.*)/);
                if (m) currentHint.id = m[1].replace(/["']/g, '').trim();
            } else if (currentHint) {
                if (trimmed.startsWith('topic:')) {
                    currentHint.topic = trimmed.replace('topic:', '').replace(/["']/g, '').trim();
                    inKeywords = false;
                } else if (trimmed.startsWith('space_key:') || trimmed.startsWith('spaceKey:')) {
                    currentHint.spaceKey = trimmed.split(':')[1].replace(/["']/g, '').trim();
                    inKeywords = false;
                } else if (trimmed.startsWith('ancestor_id:') || trimmed.startsWith('ancestorId:')) {
                    currentHint.ancestorId = trimmed.split(':')[1].replace(/["']/g, '').trim();
                    inKeywords = false;
                } else if (trimmed.startsWith('ancestor_title:') || trimmed.startsWith('ancestorTitle:')) {
                    currentHint.ancestorTitle = trimmed.split(':')[1].replace(/["']/g, '').trim();
                    inKeywords = false;
                } else if (trimmed.startsWith('guidance:')) {
                    currentHint.guidance = trimmed.replace('guidance:', '').replace(/["']/g, '').trim();
                    inKeywords = false;
                } else if (trimmed.startsWith('keywords:')) {
                    inKeywords = true;
                } else if (inKeywords && trimmed.startsWith('-')) {
                    const kw = trimmed.replace('-', '').replace(/["']/g, '').trim();
                    if (kw) currentHint.keywords.push(kw);
                }
            }
        }
        if (currentHint) hints.push(currentHint);
        return hints;
    } catch (e) {
        return [];
    }
}

function loadAllHints() {
    const userHints = config.userHintsPath ? parseHintsFile(config.userHintsPath) : [];
    const localHintsPath = config.notebookHintsPath || path.join(process.cwd(), 'HINTS.md');
    const localHints = parseHintsFile(localHintsPath);

    const merged = [...userHints];
    for (const lh of localHints) {
        const idx = merged.findIndex(u => (u.id && u.id === lh.id) || (u.topic && lh.topic && u.topic.toLowerCase() === lh.topic.toLowerCase()));
        if (idx >= 0) {
            merged[idx] = { ...merged[idx], ...lh };
        } else {
            merged.push(lh);
        }
    }
    return merged;
}

// 4. HTML / Storage Format -> Markdown 簡易変換
const BQ = String.fromCharCode(96);
function htmlToMarkdown(html, options) {
    if (!html) return '';
    let content = html;

    // CDATA & Code block
    content = content.replace(/<ac:structured-macro[^>]*ac:name="code"[^>]*>([\\s\\S]*?)<\\/ac:structured-macro>/gi, (m, body) => {
        const langM = body.match(/<ac:parameter[^>]*ac:name="language"[^>]*>([^<]+)<\\/ac:parameter>/i);
        const lang = langM ? langM[1].trim() : '';
        const codeM = body.match(/<ac:plain-text-body>[\\s\\r\\n]*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>[\\s\\r\\n]*<\\/ac:plain-text-body>/i)
            || body.match(/<ac:plain-text-body>([\\s\\S]*?)<\\/ac:plain-text-body>/i);
        const rawCode = codeM ? codeM[1] : '';
        return '\\n\\n' + BQ + BQ + BQ + lang + '\\n' + rawCode.trim() + '\\n' + BQ + BQ + BQ + '\\n\\n';
    });

    // Callout macros
    content = content.replace(/<ac:structured-macro[^>]*ac:name="(info|tip|warning|note)"[^>]*>([\\s\\S]*?)<\\/ac:structured-macro>/gi, (m, name, body) => {
        const type = name.toUpperCase() === 'INFO' || name.toUpperCase() === 'NOTE' ? 'NOTE' : name.toUpperCase();
        const innerM = body.match(/<ac:rich-text-body>([\\s\\S]*?)<\\/ac:rich-text-body>/i);
        const innerHtml = innerM ? innerM[1] : body;
        const innerMd = htmlToMarkdown(innerHtml).trim();
        const lines = innerMd.split('\\n').map(l => '> ' + l);
        return '\\n\\n> [!' + type + ']\\n' + lines.join('\\n') + '\\n\\n';
    });

    // Status macro
    content = content.replace(/<ac:structured-macro[^>]*ac:name="status"[^>]*>([\\s\\S]*?)<\\/ac:structured-macro>/gi, (m, body) => {
        const tM = body.match(/<ac:parameter[^>]*ac:name="title"[^>]*>([^<]+)<\\/ac:parameter>/i);
        return BQ + '[' + (tM ? tM[1].trim() : 'STATUS') + ']' + BQ;
    });

    // Confluence link
    content = content.replace(/<ac:link>([\\s\\S]*?)<\\/ac:link>/gi, (m, body) => {
        const pM = body.match(/<ri:page[^>]*ri:content-title="([^"]+)"/i);
        const lM = body.match(/<ac:plain-text-link-body>[\\s\\r\\n]*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>[\\s\\r\\n]*<\\/ac:plain-text-link-body>/i)
            || body.match(/<ac:link-body>([\\s\\S]*?)<\\/ac:link-body>/i);
        const title = pM ? pM[1] : '';
        const label = lM ? lM[1].trim() : '';
        if (title && label && title !== label) return '[[' + title + '|' + label + ']]';
        if (title) return '[[' + title + ']]';
        return label || '';
    });

    // Confluence image
    content = content.replace(/<ac:image[^>]*>([\\s\\S]*?)<\\/ac:image>/gi, (m, body) => {
        const captionM = body.match(/<ac:caption[^>]*>([\\s\\S]*?)<\\/ac:caption>/i);
        const caption = captionM ? captionM[1].replace(/<[^>]+>/g, '').trim() : '';

        const attachM = body.match(/<ri:attachment[^>]*ri:filename="([^"]+)"/i);
        if (attachM) {
            const filename = attachM[1].trim();
            const alt = caption || filename;
            if (options && options.imageDirPrefix) {
                const cleanPrefix = options.imageDirPrefix.replace(/\\/+$/, '');
                return '\\n\\n![' + alt + '](' + cleanPrefix + '/' + filename + ')\\n\\n';
            }
            return '\\n\\n![' + alt + '](' + filename + ')\\n\\n';
        }

        const urlM = body.match(/<ri:url[^>]*ri:value="([^"]+)"/i);
        if (urlM) {
            const alt = caption || 'image';
            return '\\n\\n![' + alt + '](' + urlM[1].trim() + ')\\n\\n';
        }

        return caption ? '\\n\\n[画像: ' + caption + ']\\n\\n' : '';
    });

    // Standard img
    content = content.replace(/<img\\b([^>]*?)\\/?>/gi, (m, attrs) => {
        const srcM = attrs.match(/src="([^"]+)"/i) || attrs.match(/src='([^']+)'/i);
        if (!srcM) return '';
        const src = srcM[1].trim();
        const altM = attrs.match(/alt="([^"]*)"/i) || attrs.match(/alt='([^']*)'/i);
        const alt = altM ? altM[1].trim() : 'image';
        return '![' + alt + '](' + src + ')';
    });

    // Standard HTML
    content = content.replace(/<pre><code>([\\s\\S]*?)<\\/code><\\/pre>/gi, (m, code) => '\\n\\n' + BQ + BQ + BQ + '\\n' + code.trim() + '\\n' + BQ + BQ + BQ + '\\n\\n');
    content = content.replace(/<code>([\\s\\S]*?)<\\/code>/gi, (m, code) => BQ + code + BQ);
    content = content.replace(/<h1[^>]*>([\\s\\S]*?)<\\/h1>/gi, '\\n\\n# $1\\n\\n');
    content = content.replace(/<h2[^>]*>([\\s\\S]*?)<\\/h2>/gi, '\\n\\n## $1\\n\\n');
    content = content.replace(/<h3[^>]*>([\\s\\S]*?)<\\/h3>/gi, '\\n\\n### $1\\n\\n');
    content = content.replace(/<h4[^>]*>([\\s\\S]*?)<\\/h4>/gi, '\\n\\n#### $1\\n\\n');
    content = content.replace(/<p[^>]*>([\\s\\S]*?)<\\/p>/gi, '\\n\\n$1\\n\\n');
    content = content.replace(/<br\\s*\\/?>/gi, '\\n');
    content = content.replace(/<li[^>]*>([\\s\\S]*?)<\\/li>/gi, '- $1\\n');
    content = content.replace(/<strong>([\\s\\S]*?)<\\/strong>/gi, '**$1**');
    content = content.replace(/<b>([\\s\\S]*?)<\\/b>/gi, '**$1**');
    content = content.replace(/<em>([\\s\\S]*?)<\\/em>/gi, '*$1*');
    content = content.replace(/<i>([\\s\\S]*?)<\\/i>/gi, '*$1*');
    content = content.replace(/<a[^>]*href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/gi, '[$2]($1)');

    // Strip remaining tags
    content = content.replace(/<[^>]+>/g, '');
    
    // HTML entities
    content = content
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

    return content.trim();
}

function sanitizeFilename(name) {
    return name.replace(/[\\\\/:*?"<>|\\s]+/g, '_').substring(0, 80);
}

// 5. サブコマンド実装

// (A) search
async function cmdSearch(query) {
    checkConfig();
    if (!query) {
        console.error('Usage: node .tools/confluence.cjs search "<query_or_cql>"');
        process.exit(1);
    }

    let cql = query.trim();
    let appliedHint = null;

    // もしすでにCQL式でなければ、HINTS.md の知恵を使って合成
    const isExplicitCql = /[~=]|\\bAND\\b|\\bOR\\b/i.test(cql);
    if (!isExplicitCql) {
        const hints = loadAllHints();
        const lowerQ = cql.toLowerCase();
        for (const h of hints) {
            const matchTopic = h.topic && lowerQ.includes(h.topic.toLowerCase());
            const matchKw = (h.keywords || []).some(k => lowerQ.includes(k.toLowerCase()) || k.toLowerCase().includes(lowerQ));
            if (matchTopic || matchKw) {
                appliedHint = h;
                break;
            }
        }

        const conditions = [];
        if (appliedHint) {
            if (appliedHint.spaceKey) conditions.push(\`space = "\${appliedHint.spaceKey}"\`);
            else if (config.defaultSpaceKey) conditions.push(\`space = "\${config.defaultSpaceKey}"\`);

            if (appliedHint.ancestorId) conditions.push(\`ancestor = "\${appliedHint.ancestorId}"\`);
            conditions.push(\`text ~ "\${cql}"\`);
        } else {
            if (config.defaultSpaceKey) conditions.push(\`space = "\${config.defaultSpaceKey}"\`);
            conditions.push(\`text ~ "\${cql}"\`);
        }
        cql = conditions.join(' AND ');
    }

    console.log(\`🔍 Searching Confluence with CQL: [\${cql}]\`);
    if (appliedHint) {
        console.log(\`🎯 Applied Search Hint: "\${appliedHint.topic}"\` + 
            (appliedHint.ancestorTitle ? \` (Ancestor: \${appliedHint.ancestorTitle})\` : '') +
            (appliedHint.guidance ? \` - Guidance: \${appliedHint.guidance}\` : ''));
    }
    console.log('');

    const endpoint = \`/rest/api/content/search?cql=\${encodeURIComponent(cql)}&limit=25&expand=ancestors,version,space\`;
    try {
        const res = await apiRequest(endpoint);
        const results = res.results || [];
        if (results.length === 0) {
            console.log('No pages found matching the query.');
            return;
        }

        console.log(\`Found \${results.length} page(s):\\n\`);
        for (const page of results) {
            const spaceKey = page.space ? page.space.key : 'UNKNOWN';
            const updated = page.version && page.version.when ? page.version.when.substring(0, 10) : 'Unknown';
            const ancestors = (page.ancestors || []).map(a => a.title).join(' / ');
            const webUrl = page._links && page._links.webui ? resolveConfluenceUrl(page._links.webui, config.baseUrl).toString() : '';

            console.log(\`- [ID: \${page.id}] "\${page.title}"\`);
            console.log(\`  Space: \${spaceKey} | Updated: \${updated}\`);
            if (ancestors) console.log(\`  Hierarchy: \${ancestors}\`);
            if (webUrl) console.log(\`  URL: \${webUrl}\`);
            console.log('');
        }

        console.log('👉 To extract any page to sources/, run:');
        console.log(\`   node .tools/confluence.cjs extract <page_id>\`);
    } catch (err) {
        console.error('❌ Search failed:', err.message);
        process.exit(1);
    }
}

// (B) extract
async function cmdExtract(pageId) {
    checkConfig();
    if (!pageId) {
        console.error('Usage: node .tools/confluence.cjs extract <page_id>');
        process.exit(1);
    }

    console.log(\`📥 Extracting page [ID: \${pageId}] from Confluence...\`);
    const endpoint = \`/rest/api/content/\${encodeURIComponent(pageId)}?expand=body.storage,version,ancestors,space\`;

    try {
        const page = await apiRequest(endpoint);
        const title = page.title || \`page_\${pageId}\`;
        const spaceKey = page.space ? page.space.key : '';
        const updated = page.version && page.version.when ? page.version.when : '';
        const webUrl = page._links && page._links.webui ? resolveConfluenceUrl(page._links.webui, config.baseUrl).toString() : '';
        const rawBody = page.body && page.body.storage ? page.body.storage.value : '';

        const sourcesDir = path.join(process.cwd(), 'sources');
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true });
        }

        // 添付画像の自動検出 & ダウンロード
        const imageFolderRel = \`confluence_\${pageId}_images\`;
        const imagesDir = path.join(sourcesDir, imageFolderRel);
        const downloadedImages = [];

        try {
            const attachEndpoint = \`/rest/api/content/\${encodeURIComponent(pageId)}/child/attachment?limit=100\`;
            const attachRes = await apiRequest(attachEndpoint);
            const attachments = attachRes.results || [];
            const imageAttachments = attachments.filter(a =>
                /\\.(png|jpe?g|gif|webp|svg)$/i.test(a.title || '')
            );

            if (imageAttachments.length > 0) {
                if (!fs.existsSync(imagesDir)) {
                    fs.mkdirSync(imagesDir, { recursive: true });
                }

                for (const img of imageAttachments) {
                    const downloadPath = img._links && img._links.download;
                    if (downloadPath) {
                        const targetFilePath = path.join(imagesDir, img.title);
                        try {
                            await downloadFile(downloadPath, targetFilePath);
                            downloadedImages.push(img.title);
                        } catch (dlErr) {
                            console.warn(\`⚠️ Failed to download image [\${img.title}]:\`, dlErr.message);
                        }
                    }
                }
            }
        } catch (attachErr) {
            console.warn(\`⚠️ Could not fetch attachments for page [\${pageId}]:\`, attachErr.message);
        }

        const imageDirPrefix = downloadedImages.length > 0 ? \`./\${imageFolderRel}\` : undefined;
        const mdBody = htmlToMarkdown(rawBody, { imageDirPrefix });
        const sanitized = sanitizeFilename(title);
        const fileName = \`confluence_\${pageId}_\${sanitized}.md\`;

        const filePath = path.join(sourcesDir, fileName);
        const now = new Date().toISOString();

        const frontmatter = [
            '---',
            'origin: confluence',
            'source_type: confluence_page',
            \`page_id: "\${pageId}"\`,
            \`title: "\${title.replace(/"/g, '\\\\"')}"\`,
            \`space: "\${spaceKey}"\`,
            \`url: "\${webUrl}"\`,
            \`updated_at: "\${updated}"\`,
            \`extracted_at: "\${now}"\`,
            '---',
            '',
            \`# \${title}\`,
            '',
            mdBody,
            ''
        ].join('\\n');

        fs.writeFileSync(filePath, frontmatter, 'utf-8');
        console.log(\`✅ Successfully extracted page [\${pageId}] to sources/\${fileName}\`);
        console.log(\`   Title: \${title}\`);
        console.log(\`   Size: \${Buffer.byteLength(frontmatter, 'utf-8')} bytes\`);
        if (downloadedImages.length > 0) {
            console.log(\`   📸 Images: \${downloadedImages.length} image(s) downloaded to sources/\${imageFolderRel}/\`);
            for (const imgName of downloadedImages) {
                console.log(\`      - sources/\${imageFolderRel}/\${imgName}\`);
            }
        }
        console.log('\\nAIエージェントの皆さんへ: Readツールで sources/' + fileName + ' を読み込んで詳細を確認してください。' +
            (downloadedImages.length > 0 ? \`\\n図表や構成図の視覚分析が必要な場合は、sources/\${imageFolderRel}/ 配下の画像を Read ツールで直接読み込んでください。\` : ''));
    } catch (err) {
        console.error(\`❌ Extract failed for page [\${pageId}]:\`, err.message);
        process.exit(1);
    }
}

// (C) hint
async function cmdHint(args) {
    let topic = '';
    let ancestor = '';
    let ancestorTitle = '';
    let space = '';
    let guidance = '';
    let keywords = [];
    let notebookOnly = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--topic' && args[i + 1]) { topic = args[++i]; }
        else if (args[i] === '--ancestor' && args[i + 1]) { ancestor = args[++i]; }
        else if (args[i] === '--ancestor-title' && args[i + 1]) { ancestorTitle = args[++i]; }
        else if (args[i] === '--space' && args[i + 1]) { space = args[++i]; }
        else if (args[i] === '--guidance' && args[i + 1]) { guidance = args[++i]; }
        else if (args[i] === '--keywords' && args[i + 1]) { keywords = args[++i].split(',').map(s => s.trim()).filter(Boolean); }
        else if (args[i] === '--notebook-only') { notebookOnly = true; }
    }

    if (!topic) {
        console.error('Usage: node .tools/confluence.cjs hint --topic "<topic>" [--ancestor "<id>"] [--ancestor-title "<title>"] [--space "<space>"] [--guidance "<text>"]');
        process.exit(1);
    }

    // 保存先決定
    const savePath = (notebookOnly || !config.userHintsPath)
        ? (config.notebookHintsPath || path.join(process.cwd(), 'HINTS.md'))
        : config.userHintsPath;

    const existingHints = parseHintsFile(savePath);
    const now = new Date().toISOString();

    const mergedKw = Array.from(new Set([topic, ...keywords]));
    const idx = existingHints.findIndex(h => h.topic && h.topic.toLowerCase() === topic.toLowerCase());

    const ruleObj = {
        id: (idx >= 0 && existingHints[idx].id) ? existingHints[idx].id : \`hint_\${Date.now()}_\${Math.random().toString(36).substring(2, 6)}\`,
        topic,
        keywords: idx >= 0 ? Array.from(new Set([...(existingHints[idx].keywords || []), ...mergedKw])) : mergedKw,
        spaceKey: space || (idx >= 0 ? existingHints[idx].spaceKey : (config.defaultSpaceKey || undefined)),
        ancestorId: ancestor || (idx >= 0 ? existingHints[idx].ancestorId : undefined),
        ancestorTitle: ancestorTitle || (idx >= 0 ? existingHints[idx].ancestorTitle : undefined),
        guidance: guidance || (idx >= 0 ? existingHints[idx].guidance : 'ユーザーフィードバックによる学習ルール'),
        updatedAt: now,
        createdAt: (idx >= 0 && existingHints[idx].createdAt) ? existingHints[idx].createdAt : now
    };

    if (idx >= 0) {
        existingHints[idx] = ruleObj;
    } else {
        existingHints.push(ruleObj);
    }

    // Markdown 生成 & 保存
    let yamlLines = ['hints:'];
    for (const h of existingHints) {
        yamlLines.push(\`  - id: \${JSON.stringify(h.id)}\`);
        yamlLines.push(\`    topic: \${JSON.stringify(h.topic)}\`);
        yamlLines.push('    keywords:');
        for (const kw of (h.keywords || [])) {
            yamlLines.push(\`      - \${JSON.stringify(kw)}\`);
        }
        if (h.spaceKey) yamlLines.push(\`    space_key: \${JSON.stringify(h.spaceKey)}\`);
        if (h.ancestorId) yamlLines.push(\`    ancestor_id: \${JSON.stringify(h.ancestorId)}\`);
        if (h.ancestorTitle) yamlLines.push(\`    ancestor_title: \${JSON.stringify(h.ancestorTitle)}\`);
        if (h.guidance) yamlLines.push(\`    guidance: \${JSON.stringify(h.guidance)}\`);
        yamlLines.push(\`    created_at: \${JSON.stringify(h.createdAt)}\`);
        yamlLines.push(\`    updated_at: \${JSON.stringify(h.updatedAt)}\`);
    }

    let md = \`---\\n\${yamlLines.join('\\n')}\\n---\\n# 🧭 探索の知恵 (Search Hints)\\n\\n\`;
    md += \`<!-- このファイルは外部ソース探索の知恵・過去の学習履歴を記録します。\\n\`;
    md += \`     ユーザーからの助言やAIの学習結果が蓄積され、次回以降の探索精度が自動で向上します。\\n\`;
    md += \`     手動での編集・追記・他メンバーへの共有も可能です。 -->\\n\\n\`;
    md += \`## Confluence 探索ルール\\n\\n\`;

    for (const h of existingHints) {
        md += '### 📌 ' + h.topic + '\\n';
        if (h.spaceKey) md += '- **推奨スペース**: ' + BQ + h.spaceKey + BQ + '\\n';
        if (h.ancestorTitle || h.ancestorId) {
            const t = h.ancestorTitle ? BQ + h.ancestorTitle + BQ : '';
            const id = h.ancestorId ? ' (ID: ' + h.ancestorId + ')' : '';
            md += '- **推奨親ページ (Ancestor)**: ' + t + id + '\\n';
        }
        if (h.guidance) md += '- **理由・助言**: ' + h.guidance + '\\n';
        if (h.keywords && h.keywords.length > 0) {
            md += '- **対象キーワード**: ' + h.keywords.map(k => BQ + k + BQ).join(', ') + '\\n';
        }
        md += '- *(更新日時: ' + h.updatedAt + ')*\\n\\n';
    }

    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(savePath, md, 'utf-8');

    console.log(\`✅ Successfully learned search hint:\`);
    console.log(\`- Topic: \${ruleObj.topic}\`);
    if (ruleObj.spaceKey) console.log(\`- Space: \${ruleObj.spaceKey}\`);
    if (ruleObj.ancestorId) console.log(\`- Ancestor: \${ruleObj.ancestorTitle || ''} (ID: \${ruleObj.ancestorId})\`);
    if (ruleObj.guidance) console.log(\`- Guidance: \${ruleObj.guidance}\`);
    console.log(\`- Saved to: \${savePath} (\${notebookOnly ? 'Notebook固有' : 'ユーザー共通'})\`);
}

// メインルーター
async function main() {
    const subcmd = process.argv[2];
    const restArgs = process.argv.slice(3);

    if (subcmd === 'search') {
        await cmdSearch(restArgs.join(' '));
    } else if (subcmd === 'extract') {
        await cmdExtract(restArgs[0]);
    } else if (subcmd === 'hint') {
        await cmdHint(restArgs);
    } else {
        console.log('Confluence CLI Helper for Obsidian AI Notebook');
        console.log('\\nUsage:');
        console.log('  node .tools/confluence.cjs search "<keyword_or_cql>"');
        console.log('  node .tools/confluence.cjs extract <page_id>');
        console.log('  node .tools/confluence.cjs hint --topic "<topic>" [--ancestor "<id>"] [--guidance "<text>"]');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
`;
}
