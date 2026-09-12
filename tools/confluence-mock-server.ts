import * as http from 'http';
import * as url from 'url';

export interface MockPage {
    id: string;
    title: string;
    spaceKey: string;
    spaceName: string;
    ancestors: { id: string; title: string }[];
    version: number;
    updatedAt: string;
    storageBody: string;
    viewBody?: string;
}

export interface MockSpace {
    key: string;
    name: string;
    description?: string;
}

/**
 * 社内Wikiのリアルなゴミ山・カオス階層データを生成
 */
export function generateChaosWikiData(): { pages: MockPage[]; spaces: MockSpace[] } {
    const spaces: MockSpace[] = [
        { key: 'DEV-ARCH', name: '開発アーキテクチャ', description: '次世代システムのアーキテクチャ設計・API仕様' },
        { key: 'PROD-OLD', name: '旧システム運用', description: '2021〜2023年稼働のレガシーシステム運用Wiki' },
        { key: 'CORP', name: '全社総務・セキュリティ', description: '総務部・情シス部の各種申請・セキュリティ手続き' },
        { key: 'TEAM-A', name: 'Aチーム開発メモ', description: '日常の雑多な開発メモ・日報・雑談' },
    ];

    const pages: MockPage[] = [];

    // ==========================================
    // 1. DEV-ARCH (大正解の最新仕様 & 旧検討メモ)
    // ==========================================
    const devArchHome = { id: '10001', title: 'DEV-ARCH ホーム' };
    const renewal2025 = { id: '10002', title: '2025年リニューアル' };
    const latestApiDef = { id: '10003', title: '最新API定義' };

    // ★大正解: 2025年リニューアル / 最新API定義 / JWTトークン仕様書
    pages.push({
        id: '10004',
        title: 'JWTトークン仕様書',
        spaceKey: 'DEV-ARCH',
        spaceName: '開発アーキテクチャ',
        ancestors: [devArchHome, renewal2025, latestApiDef],
        version: 3,
        updatedAt: '2026-03-01T10:00:00.000Z',
        storageBody: `
<ac:structured-macro ac:name="info">
  <ac:rich-text-body>
    <p><strong>【最新正解】</strong> 本ドキュメントは2025年リニューアルプロジェクトにおける公式の認証・認可JWT仕様書です。</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h1>1. 認証トークン概要</h1>
<p>認証基盤（Auth Service）が発行するJWTトークンは、<strong>RSA256 (RS256)</strong> アルゴリズムで署名されます。</p>
<p>クライアントはAPI Gateway (APIGW) または各マイクロサービスへリクエストを送信する際、<code>Authorization</code> ヘッダーに Bearer トークンとして付与します。</p>

<h2>トークン仕様</h2>
<table>
  <thead>
    <tr>
      <th>項目</th>
      <th>仕様値</th>
      <th>説明</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>署名アルゴリズム</strong></td>
      <td>RS256 (RSA Signature with SHA-256)</td>
      <td>公開鍵暗号による検証。秘密鍵はAuth Serviceのみが保持。</td>
    </tr>
    <tr>
      <td><strong>アクセストークン有効期限</strong></td>
      <td>15分 (900秒)</td>
      <td>短命トークンにより漏洩リスクを最小化。</td>
    </tr>
    <tr>
      <td><strong>リフレッシュトークン有効期限</strong></td>
      <td>7日間 (604,800秒)</td>
      <td>Redisセッションストアで管理し、ローテーション必須。</td>
    </tr>
    <tr>
      <td><strong>公開鍵エンドポイント (JWKS)</strong></td>
      <td><code>https://auth.internal.example.com/.well-known/jwks.json</code></td>
      <td>Kong APIGW および各サービスが起動時およびキャッシュ期限切れ時に参照。</td>
    </tr>
  </tbody>
</table>

<h2>ヘッダー形式サンプル</h2>
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">http</ac:parameter>
  <ac:plain-text-body><![CDATA[GET /api/v2/user/profile HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
Accept: application/json]]></ac:plain-text-body>
</ac:structured-macro>
`
    });

    // 2025年リニューアル / 最新API定義 / ユーザー認可ロール定義
    pages.push({
        id: '10005',
        title: 'ユーザー認可ロール定義',
        spaceKey: 'DEV-ARCH',
        spaceName: '開発アーキテクチャ',
        ancestors: [devArchHome, renewal2025, latestApiDef],
        version: 2,
        updatedAt: '2026-02-15T14:30:00.000Z',
        storageBody: `
<h1>ユーザー認可ロール定義</h1>
<p>JWTトークンの <code>roles</code> クレームに含まれる認可ロールの定義一覧です。</p>
<ul>
  <li><code>admin</code>: システム管理者（全リソースのCRUD権限）</li>
  <li><code>developer</code>: 開発者（API利用・ログ閲覧権限）</li>
  <li><code>operator</code>: 運用オペレーター（読み取り専用権限）</li>
</ul>
`
    });

    // 2025年リニューアル / 全体方針
    pages.push({
        id: '10007',
        title: '全体アーキテクチャ方針',
        spaceKey: 'DEV-ARCH',
        spaceName: '開発アーキテクチャ',
        ancestors: [devArchHome, renewal2025],
        version: 4,
        updatedAt: '2026-01-10T09:00:00.000Z',
        storageBody: `
<h1>2025年リニューアル 全体アーキテクチャ方針</h1>
<p>本プロジェクトではモノリス構成から AWS ECS Fargate ベースのマイクロサービスへの段階的移行を実施します。</p>
`
    });

    // DEV-ARCH / 2024年 / 認証基盤移行計画 (旧検討メモ・途中で方針変更)
    const old2024 = { id: '10010', title: '2024年検討' };
    pages.push({
        id: '10011',
        title: '認証基盤移行計画',
        spaceKey: 'DEV-ARCH',
        spaceName: '開発アーキテクチャ',
        ancestors: [devArchHome, old2024],
        version: 1,
        updatedAt: '2024-06-20T11:00:00.000Z',
        storageBody: `
<ac:structured-macro ac:name="warning">
  <ac:rich-text-body>
    <p><strong>【検討凍結】</strong> 本計画書は2024年当時の初期ドラフトであり、2025年リニューアル計画により全面改訂されました。</p>
  </ac:rich-text-body>
</ac:structured-macro>
<h1>認証基盤移行計画 (2024年案)</h1>
<p>当初はKeycloak導入を検討したが、運用負荷のため内製Auth Serviceへの刷新に決定した。</p>
`
    });

    // ==========================================
    // 2. PROD-OLD (旧システム運用 - ゴミ山・レガシー仕様)
    // ==========================================
    const prodOldHome = { id: '20001', title: 'PROD-OLD ホーム' };
    const oldYear2021 = { id: '20002', title: '2021年アーカイブ' };

    // ⚠️非推奨・ノイズ: 認証仕様書 (HS256・古いCookieセッション)
    pages.push({
        id: '20003',
        title: '認証仕様書',
        spaceKey: 'PROD-OLD',
        spaceName: '旧システム運用',
        ancestors: [prodOldHome, oldYear2021],
        version: 8,
        updatedAt: '2021-11-05T16:00:00.000Z',
        storageBody: `
<ac:structured-macro ac:name="warning">
  <ac:rich-text-body>
    <p><strong>【非推奨・レガシー】</strong> この認証仕様書は旧システム(v1)専用です。2025年リニューアルではRS256の最新仕様書を参照してください！</p>
  </ac:rich-text-body>
</ac:structured-macro>
<h1>旧認証仕様書 (v1)</h1>
<p>旧システムでは <strong>HS256 (共通鍵方式)</strong> を使用し、秘密鍵 <code>secret123</code> で署名したCookieトークンを用いています。</p>
<p>有効期限は24時間です。</p>
`
    });

    pages.push({
        id: '20004',
        title: '旧APIゲートウェイ設定手順',
        spaceKey: 'PROD-OLD',
        spaceName: '旧システム運用',
        ancestors: [prodOldHome, oldYear2021],
        version: 5,
        updatedAt: '2021-08-12T10:00:00.000Z',
        storageBody: '<p>Apache HTTP Serverによるリバースプロキシ設定手順です。</p>'
    });

    pages.push({
        id: '20005',
        title: '旧トークン失効バッチトラブル報告',
        spaceKey: 'PROD-OLD',
        spaceName: '旧システム運用',
        ancestors: [prodOldHome, oldYear2021],
        version: 2,
        updatedAt: '2022-04-03T18:00:00.000Z',
        storageBody: '<p>日次認証トークンクリーンアップバッチがタイムアウトしたインシデントの報告書です。</p>'
    });

    // ==========================================
    // 3. CORP (全社総務・セキュリティ - 同名ノイズ)
    // ==========================================
    const corpHome = { id: '30001', title: 'CORP ホーム' };
    const corpGa = { id: '30002', title: '総務部手続き' };
    const corpIt = { id: '30005', title: '情シス部手続き' };

    // ⚠️完全なノイズ: セキュリティカード紛失時の認証手続き
    pages.push({
        id: '30003',
        title: 'セキュリティカード紛失時の認証手続き',
        spaceKey: 'CORP',
        spaceName: '全社総務・セキュリティ',
        ancestors: [corpHome, corpGa],
        version: 6,
        updatedAt: '2025-09-01T09:00:00.000Z',
        storageBody: `
<h1>セキュリティカード（社員証）紛失時の認証・再発行手続き</h1>
<p>オフィス入館用ICカードを紛失した場合、速やかに総務部窓口で本人確認認証を行ってください。</p>
<p>運転免許証またはマイナンバーカードによる本人認証が必要です。再発行手数料は2,000円です。</p>
`
    });

    // ⚠️ノイズ: 社内Wi-Fiパスワード認証方法
    pages.push({
        id: '30006',
        title: '社内Wi-Fiパスワード認証方法',
        spaceKey: 'CORP',
        spaceName: '全社総務・セキュリティ',
        ancestors: [corpHome, corpIt],
        version: 4,
        updatedAt: '2025-04-10T11:00:00.000Z',
        storageBody: `
<h1>社内Wi-Fi (802.1X認証) 接続ガイド</h1>
<p>SSID: <code>Corp-Secure-WiFi</code></p>
<p>認証方式: WPA2-Enterprise (EAP-TLS または PEAP-MSCHAPv2)</p>
<p>社内アカウントのIDとパスワードで認証してください。</p>
`
    });

    // ⚠️ノイズ: 健康診断受診の本人認証手順
    pages.push({
        id: '30007',
        title: '健康診断受診の本人認証手順',
        spaceKey: 'CORP',
        spaceName: '全社総務・セキュリティ',
        ancestors: [corpHome, corpGa],
        version: 1,
        updatedAt: '2025-05-15T08:00:00.000Z',
        storageBody: '<p>秋の定期健康診断の受診時には、病院受付にて保険証による本人認証を行ってください。</p>'
    });

    // ⚠️ノイズ: PCログインActiveDirectory認証エラーの対処法
    pages.push({
        id: '30008',
        title: 'PCログインActiveDirectory認証エラーの対処法',
        spaceKey: 'CORP',
        spaceName: '全社総務・セキュリティ',
        ancestors: [corpHome, corpIt],
        version: 3,
        updatedAt: '2024-11-20T17:00:00.000Z',
        storageBody: '<p>Windows PCログイン時に「ドメイン認証に失敗しました」と表示された場合のパスワードリセット手順です。</p>'
    });

    // ==========================================
    // 4. カオスな大量ダミーページ（100ページ以上生成）
    // ==========================================
    const teamAHome = { id: '40001', title: 'TEAM-A ホーム' };
    const topics = [
        'ランチおすすめマップ (渋谷・恵比寿)',
        '有給休暇取得ルールと年末調整について',
        '2024年度下期キックオフ議事録',
        '2025年新卒研修カリキュラム案',
        'Docker環境構築で詰まったポイント備忘録',
        'TypeScript 5.3 の新機能まとめ',
        '社内Mattermost運用のガイドライン',
        'GitLab CI/CD パイプライン最適化Tips',
        '毎週水曜日のチーム朝会アジェンダ',
        'オフィス給湯器の使い方とコーヒー豆の補充について',
        '社内勉強会: Clean Architecture 入門',
        '本番障害報告書: 2024-08 ALB 502エラー多発事案',
        'Datadog APM導入手順書',
        'AWS コスト削減タスクフォース検討結果',
        'MacBook Pro 買い替え申請手順'
    ];

    for (let i = 0; i < 90; i++) {
        const topic = topics[i % topics.length];
        const pageId = String(50000 + i);
        pages.push({
            id: pageId,
            title: `${topic} #${Math.floor(i / topics.length) + 1}`,
            spaceKey: i % 2 === 0 ? 'TEAM-A' : 'CORP',
            spaceName: i % 2 === 0 ? 'Aチーム開発メモ' : '全社総務・セキュリティ',
            ancestors: [i % 2 === 0 ? teamAHome : corpHome],
            version: (i % 5) + 1,
            updatedAt: new Date(Date.now() - (i * 86400000 * 2)).toISOString(),
            storageBody: `<p>${topic}に関するメモです。詳細は関係者まで確認してください。更新インデックス: ${i}</p>`
        });
    }

    return { pages, spaces };
}

/**
 * 簡易 CQL クエリパーサー & マッチャー
 */
export function matchCql(page: MockPage, cql: string): boolean {
    if (!cql || !cql.trim()) return true;

    // AND で分割
    const conditions = cql.split(/\s+AND\s+/i);

    for (const cond of conditions) {
        const trimmed = cond.trim();
        if (!trimmed) continue;

        // space = "KEY" または space = KEY
        const spaceMatch = trimmed.match(/^space\s*=\s*["']?([^"'\s]+)["']?$/i);
        if (spaceMatch) {
            if (page.spaceKey.toLowerCase() !== spaceMatch[1].toLowerCase()) {
                return false;
            }
            continue;
        }

        // ancestor = "ID" または ancestor = ID または ancestor = "Title"
        const ancestorMatch = trimmed.match(/^ancestor\s*=\s*["']?([^"'\s]+)["']?$/i);
        if (ancestorMatch) {
            const target = ancestorMatch[1].toLowerCase();
            const hasAncestor = page.ancestors.some(
                a => a.id.toLowerCase() === target || a.title.toLowerCase().includes(target)
            );
            if (!hasAncestor) {
                return false;
            }
            continue;
        }

        // title ~ "keyword"
        const titleMatch = trimmed.match(/^title\s*~\s*["']?([^"']+)["']?$/i);
        if (titleMatch) {
            const kw = titleMatch[1].toLowerCase();
            if (!page.title.toLowerCase().includes(kw)) {
                return false;
            }
            continue;
        }

        // text ~ "keyword"
        const textMatch = trimmed.match(/^text\s*~\s*["']?([^"']+)["']?$/i);
        if (textMatch) {
            const kw = textMatch[1].toLowerCase();
            const inTitle = page.title.toLowerCase().includes(kw);
            const inBody = page.storageBody.toLowerCase().includes(kw);
            if (!inTitle && !inBody) {
                return false;
            }
            continue;
        }

        // type = page (常に true)
        if (/^type\s*=\s*page$/i.test(trimmed)) {
            continue;
        }
    }

    return true;
}

/**
 * Confluence カオス・シミュレーター HTTP サーバー
 */
export class ConfluenceChaosSimulator {
    private pages: MockPage[];
    private spaces: MockSpace[];
    private server: http.Server | null = null;
    private port: number = 0;

    constructor(initialData?: { pages: MockPage[]; spaces: MockSpace[] }) {
        const data = initialData || generateChaosWikiData();
        this.pages = data.pages;
        this.spaces = data.spaces;
    }

    getAllPages(): MockPage[] {
        return this.pages;
    }

    findPageById(id: string): MockPage | undefined {
        return this.pages.find(p => p.id === id);
    }

    search(cql: string, limit: number = 25, start: number = 0): { results: any[]; totalSize: number } {
        const matched = this.pages.filter(p => matchCql(p, cql));
        const paged = matched.slice(start, start + limit);

        const results = paged.map(p => ({
            id: p.id,
            type: 'page',
            status: 'current',
            title: p.title,
            space: {
                key: p.spaceKey,
                name: p.spaceName
            },
            ancestors: p.ancestors,
            version: {
                number: p.version,
                when: p.updatedAt
            },
            _links: {
                webui: `/spaces/${p.spaceKey}/pages/${p.id}/${encodeURIComponent(p.title)}`,
                self: `http://localhost:${this.port}/rest/api/content/${p.id}`
            }
        }));

        return {
            results,
            totalSize: matched.length
        };
    }

    async start(port: number = 0): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                const parsedUrl = new URL(req.url || '', `http://localhost:${this.port || 3000}`);
                const pathname = parsedUrl.pathname || '';

                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                // GET /rest/api/space
                if (pathname === '/rest/api/space' || pathname === '/wiki/rest/api/space') {
                    res.writeHead(200);
                    res.end(JSON.stringify({ results: this.spaces }));
                    return;
                }

                // GET /rest/api/content/search?cql=...
                if (pathname === '/rest/api/content/search' || pathname === '/wiki/rest/api/content/search') {
                    const cql = parsedUrl.searchParams.get('cql') || '';
                    const limit = parseInt(parsedUrl.searchParams.get('limit') || '25', 10);
                    const start = parseInt(parsedUrl.searchParams.get('start') || '0', 10);

                    const searchRes = this.search(cql, limit, start);
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        results: searchRes.results,
                        start,
                        limit,
                        size: searchRes.results.length,
                        totalSize: searchRes.totalSize
                    }));
                    return;
                }

                // GET /rest/api/content/:id
                const contentMatch = pathname.match(/^(?:\/wiki)?\/rest\/api\/content\/([^\/]+)$/);
                if (contentMatch) {
                    const pageId = contentMatch[1];
                    const page = this.findPageById(pageId);
                    if (!page) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ statusCode: 404, message: `Page with id ${pageId} not found` }));
                        return;
                    }

                    const pageData: any = {
                        id: page.id,
                        type: 'page',
                        status: 'current',
                        title: page.title,
                        space: {
                            key: page.spaceKey,
                            name: page.spaceName
                        },
                        ancestors: page.ancestors,
                        version: {
                            number: page.version,
                            when: page.updatedAt
                        },
                        body: {
                            storage: {
                                value: page.storageBody,
                                representation: 'storage'
                            },
                            view: {
                                value: page.viewBody || page.storageBody,
                                representation: 'view'
                            }
                        },
                        _links: {
                            webui: `/spaces/${page.spaceKey}/pages/${page.id}/${encodeURIComponent(page.title)}`,
                            self: `http://localhost:${this.port}/rest/api/content/${page.id}`
                        }
                    };

                    res.writeHead(200);
                    res.end(JSON.stringify(pageData));
                    return;
                }

                res.writeHead(404);
                res.end(JSON.stringify({ statusCode: 404, message: 'Endpoint not found' }));
            });

            this.server.listen(port, () => {
                const addr = this.server?.address();
                if (addr && typeof addr === 'object') {
                    this.port = addr.port;
                    resolve(this.port);
                } else {
                    reject(new Error('Failed to obtain server address'));
                }
            });

            this.server.on('error', reject);
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    getPort(): number {
        return this.port;
    }
}
