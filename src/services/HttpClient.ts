import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface HttpRequestOptions extends Omit<RequestUrlParam, 'body'> {
    body?: string | ArrayBuffer | ArrayBufferView | Buffer;
    connectionMode?: 'default' | 'direct';
    insecureSsl?: boolean; // 自己署名証明書・社内プライベートCAの検証エラーをスキップ
}

export class HttpClient {
    /**
     * HTTP リクエストを実行（connectionMode: 'default' | 'direct'）
     * - 'default': Obsidian 標準の requestUrl（Electron/Chromium ネットワークスタック、PAC・システムプロキシ経由）
     * - 'direct': Node.js http/https モジュールによるダイレクト通信（PAC・システムプロキシを完全バイパス）
     */
    static async request(param: HttpRequestOptions | string, defaultMode: 'default' | 'direct' = 'default'): Promise<RequestUrlResponse> {
        const options: HttpRequestOptions = typeof param === 'string' ? { url: param } : param;
        const mode = options.connectionMode || defaultMode;

        let response: RequestUrlResponse;
        try {
            if (mode === 'direct') {
                response = await this.nodeDirectRequest(options);
            } else {
                // Default mode using Obsidian requestUrl
                const obsOptions: RequestUrlParam = {
                    url: options.url,
                    method: options.method,
                    headers: options.headers,
                    throw: options.throw !== undefined ? options.throw : false,
                };
                if (options.body) {
                    if (typeof options.body === 'string') {
                        obsOptions.body = options.body;
                    } else if (options.body instanceof ArrayBuffer) {
                        obsOptions.body = options.body;
                    } else if (Buffer.isBuffer(options.body)) {
                        obsOptions.body = (options.body.buffer as ArrayBuffer).slice(
                            options.body.byteOffset,
                            options.body.byteOffset + options.body.byteLength
                        );
                    } else if (ArrayBuffer.isView(options.body)) {
                        obsOptions.body = (options.body.buffer as ArrayBuffer).slice(
                            options.body.byteOffset,
                            options.body.byteOffset + options.body.byteLength
                        );
                    }
                }
                response = await requestUrl(obsOptions);
            }
        } catch (error: any) {
            console.error(`[AI Notebook:HTTP] Network request failed for ${options.url} (Mode: ${mode}):`, error);
            throw error;
        }

        if (response.status >= 400) {
            this.logDiagnostic(options.url, mode, response, options);
        }

        return response;
    }

    /**
     * multipart/form-data のアップロードをネイティブ実行
     * ブラウザ標準 fetch の CORS 制約および PAC 誤転送を完全回避
     */
    static async uploadMultipart(
        url: string,
        fileData: Buffer | Uint8Array | ArrayBuffer,
        fileName: string,
        fieldName = 'file',
        headers: Record<string, string> = {},
        options: { connectionMode?: 'default' | 'direct'; insecureSsl?: boolean } = {}
    ): Promise<RequestUrlResponse> {
        const boundary = `----ObsidianAiNotebookBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;

        const headerPart = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${encodeURIComponent(fileName)}"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n`
        );
        const footerPart = Buffer.from(`\r\n--${boundary}--\r\n`);

        let fileBuffer: Buffer;
        if (Buffer.isBuffer(fileData)) {
            fileBuffer = fileData;
        } else if (fileData instanceof Uint8Array) {
            fileBuffer = Buffer.from(fileData.buffer, fileData.byteOffset, fileData.byteLength);
        } else {
            fileBuffer = Buffer.from(fileData);
        }

        const bodyBuffer = Buffer.concat([headerPart, fileBuffer, footerPart]);

        const requestHeaders: Record<string, string> = {
            ...headers,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': bodyBuffer.length.toString()
        };

        return this.request({
            url,
            method: 'POST',
            headers: requestHeaders,
            body: bodyBuffer,
            connectionMode: options.connectionMode,
            insecureSsl: options.insecureSsl,
            throw: false
        });
    }

    /**
     * 大文字小文字を無視してヘッダーを取得
     */
    static getHeader(headers: Record<string, string> = {}, name: string): string | undefined {
        const target = name.toLowerCase();
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === target) {
                return headers[key];
            }
        }
        return undefined;
    }

    /**
     * レスポンスステータス >= 400 の場合の診断ログ出力
     */
    private static logDiagnostic(url: string, mode: string, res: RequestUrlResponse, options?: HttpRequestOptions): void {
        const headers = res.headers || {};
        const text = res.text || '';
        const method = options?.method || 'GET';

        const serverHeader = this.getHeader(headers, 'server') || '';
        const viaHeader = this.getHeader(headers, 'via') || '';
        const contentType = this.getHeader(headers, 'content-type') || '';
        const isHtmlBlock = contentType.includes('text/html') && (
            text.includes('Blocked') || text.includes('Forbidden') || text.includes('Filter') ||
            text.includes('Policy') || text.includes('Proxy') || text.includes('Zscaler') ||
            text.includes('Access Denied')
        );
        const isKnownProxy = /zscaler|squid|bluecoat|envoy|nginx|apache/i.test(serverHeader) || Boolean(viaHeader);

        let cause = `HTTP ${res.status}`;
        let suggestion = 'ネットワーク接続またはサーバーの状態を確認してください。';

        if (res.status === 403 || res.status === 401 || res.status === 502 || res.status === 504) {
            if (isKnownProxy || isHtmlBlock) {
                cause = `[社内プロキシ / セキュリティゲートウェイ遮断] プロキシ経由でブロックされた可能性があります (Server: "${serverHeader || 'unknown'}", Via: "${viaHeader || 'none'}")。`;
                suggestion = 'サーバー設定で「接続モード」を「ダイレクト通信 (PAC・プロキシをバイパス)」に切り替えてください。';
            } else if (res.status === 401 || text.includes('Unauthorized') || text.includes('Bad credentials')) {
                cause = `[認証失敗 (401)] アクセストークンが無効または期限切れです。`;
                suggestion = 'サーバー設定でトークンを再確認・更新してください。';
            } else if (res.status === 403) {
                cause = `[アクセス拒否 (403)] 権限不足、または社内ネットワーク遮断の可能性があります。`;
                suggestion = 'トークンの権限スコープを確認するか、接続モードを「ダイレクト通信」に切り替えてみてください。';
            }
        }

        let bodyPreview = text.trim();
        if (bodyPreview.length > 500) {
            bodyPreview = bodyPreview.slice(0, 500) + '... (truncated)';
        }

        console.error(
            `[AI Notebook:HTTP] ❌ HTTP ${res.status} on ${method} ${url}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📌 原因: ${cause}\n` +
            `🌐 リクエスト: ${method} ${url} (Mode: ${mode})\n` +
            `💡 対処法: ${suggestion}\n` +
            (bodyPreview ? `📄 レスポンス本文:\n${bodyPreview}\n` : '') +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );
    }

    /**
     * Node.js 標準 http/https モジュールによるダイレクト通信
     * OS の PAC ファイルおよび Chromium システムプロキシを完全バイパス
     */
    private static nodeDirectRequest(options: HttpRequestOptions, redirectCount = 0): Promise<RequestUrlResponse> {
        const MAX_REDIRECTS = 5;

        return new Promise((resolve, reject) => {
            if (redirectCount > MAX_REDIRECTS) {
                return reject(new Error(`リダイレクト上限を超えました (最大 ${MAX_REDIRECTS} 回)`));
            }

            try {
                const parsedUrl = new URL(options.url);
                const isHttps = parsedUrl.protocol === 'https:';
                const client = isHttps ? https : http;

                const headers: Record<string, string> = {
                    'User-Agent': 'Obsidian-AI-Notebook/1.0',
                    ...(options.headers || {})
                };

                const reqOptions: https.RequestOptions = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80),
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: options.method || 'GET',
                    headers: headers
                };

                if (isHttps && options.insecureSsl) {
                    reqOptions.rejectUnauthorized = false;
                }

                const req = client.request(reqOptions, (res) => {
                    // HTTP リダイレクト処理 (301, 302, 303, 307, 308)
                    if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                        const nextUrl = new URL(res.headers.location, options.url).toString();
                        res.resume(); // 未読込レスポンスを破棄
                        const nextOptions: HttpRequestOptions = {
                            ...options,
                            url: nextUrl,
                            method: (res.statusCode === 303 || (res.statusCode === 302 && options.method !== 'HEAD')) ? 'GET' : options.method
                        };
                        return resolve(this.nodeDirectRequest(nextOptions, redirectCount + 1));
                    }

                    const chunks: Buffer[] = [];
                    res.on('data', (chunk) => {
                        chunks.push(chunk);
                    });

                    res.on('end', () => {
                        const buffer = Buffer.concat(chunks);
                        const text = buffer.toString('utf8');
                        let json: any = null;
                        try {
                            json = JSON.parse(text);
                        } catch (e) {
                            // JSON でない場合は null
                        }

                        const responseHeaders: Record<string, string> = {};
                        for (const [key, value] of Object.entries(res.headers)) {
                            if (value !== undefined) {
                                responseHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
                            }
                        }

                        const arrayBuffer = buffer.buffer.slice(
                            buffer.byteOffset,
                            buffer.byteOffset + buffer.byteLength
                        );

                        resolve({
                            status: res.statusCode || 200,
                            headers: responseHeaders,
                            text: text,
                            json: json,
                            arrayBuffer: arrayBuffer
                        });
                    });
                });

                req.on('error', (err) => {
                    reject(err);
                });

                if (options.body) {
                    if (typeof options.body === 'string') {
                        req.write(options.body);
                    } else if (Buffer.isBuffer(options.body)) {
                        req.write(options.body);
                    } else if (options.body instanceof ArrayBuffer) {
                        req.write(Buffer.from(options.body));
                    } else if (ArrayBuffer.isView(options.body)) {
                        req.write(Buffer.from(options.body.buffer, options.body.byteOffset, options.body.byteLength));
                    }
                }

                req.end();
            } catch (err) {
                reject(err);
            }
        });
    }
}
