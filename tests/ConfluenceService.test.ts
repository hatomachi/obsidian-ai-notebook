import assert from 'assert';
import { ConfluenceService } from '../src/services/ConfluenceService';
import { confluenceHtmlToMarkdown } from '../src/services/confluence/ConfluenceHtmlToMarkdown';
import { ConfluenceChaosSimulator } from '../tools/confluence-mock-server';
import { AINotebookSettings, DEFAULT_SETTINGS } from '../src/types';

async function runTests() {
    console.log('=== ConfluenceService 単体テスト開始 ===');

    // Test 1: confluenceHtmlToMarkdown のパース・変換機能検証
    console.log('Test 1: Confluence HTML/Storage Format ➡ Markdown 変換の検証');
    const sampleStorageXml = `
<ac:structured-macro ac:name="info">
  <ac:rich-text-body>
    <p>これは<strong>重要</strong>なお知らせです。</p>
  </ac:rich-text-body>
</ac:structured-macro>
<h1>見出し1</h1>
<p>通常のテキスト。<a href="https://example.com">リンク</a>と<code>インラインコード</code>。</p>
<ac:structured-macro ac:name="code">
  <ac:parameter ac:name="language">typescript</ac:parameter>
  <ac:plain-text-body><![CDATA[const x: number = 42;
console.log(x);]]></ac:plain-text-body>
</ac:structured-macro>
<table>
  <thead>
    <tr><th>項目</th><th>値</th></tr>
  </thead>
  <tbody>
    <tr><td>アルゴリズム</td><td>RS256</td></tr>
  </tbody>
</table>
<ul>
  <li>項目 A</li>
  <li>項目 B</li>
</ul>
<ac:link><ri:page ri:content-title="親ページ" /><ac:plain-text-link-body><![CDATA[リンク表示名]]></ac:plain-text-link-body></ac:link>
`;

    const md = confluenceHtmlToMarkdown(sampleStorageXml);
    assert(md.includes('> [!NOTE]'), 'コールアウト NOTE が生成されていません');
    assert(md.includes('> これは**重要**なお知らせです。'), 'コールアウト内の太字が変換されていません');
    assert(md.includes('# 見出し1'), '見出し1が変換されていません');
    assert(md.includes('[リンク](https://example.com)'), 'リンクが変換されていません');
    assert(md.includes('`インラインコード`'), 'インラインコードが変換されていません');
    assert(md.includes('```typescript\nconst x: number = 42;\nconsole.log(x);\n```'), 'コードブロックが正しく変換されていません');
    assert(md.includes('| 項目 | 値 |'), 'テーブルヘッダーが変換されていません');
    assert(md.includes('| アルゴリズム | RS256 |'), 'テーブルデータ行が変換されていません');
    assert(md.includes('- 項目 A'), '箇条書きリストが変換されていません');
    assert(md.includes('[[親ページ|リンク表示名]]'), 'Confluence 内部リンクが変換されていません');
    console.log('  -> OK: HTML ➡ Markdown 変換精度合格');

    // Test 2: ConfluenceService と モックサーバー連携
    console.log('Test 2: ConfluenceService API メソッド検証 (CQL検索・詳細取得・インポート)');
    const simulator = new ConfluenceChaosSimulator();
    const port = await simulator.start(0);
    const mockBaseUrl = `http://localhost:${port}`;

    try {
        const settings: AINotebookSettings = {
            ...DEFAULT_SETTINGS,
            confluenceServers: [
                {
                    id: 'mock-confluence',
                    name: 'ローカルモックサーバー',
                    baseUrl: mockBaseUrl,
                    authType: 'bearer',
                    token: 'dummy-mock-pat',
                    defaultSpaceKey: 'DEV-ARCH'
                }
            ],
            defaultConfluenceServerId: 'mock-confluence'
        };

        const service = new ConfluenceService(settings);

        // 接続テスト
        const testConn = await service.testConnection(settings.confluenceServers![0]);
        assert.strictEqual(testConn.success, true, `接続テスト失敗: ${testConn.message}`);
        console.log(`  -> OK: testConnection 成功 (${testConn.message})`);

        // CQL検索（ヒントなし）
        const searchRes = await service.search('text ~ "認証"');
        assert(searchRes.results.length >= 4, `検索結果件数が少なすぎます: ${searchRes.results.length}`);
        assert(searchRes.results.some(r => r.id === '10004'));
        assert(searchRes.results.some(r => r.space?.key === 'PROD-OLD'));
        console.log(`  -> OK: 広域CQL検索成功 (${searchRes.results.length} 件ヒット)`);

        // CQL検索（ヒント付き）
        const filteredRes = await service.search('ancestor = "10002" AND text ~ "認証"');
        assert.strictEqual(filteredRes.results.length, 1);
        assert.strictEqual(filteredRes.results[0].id, '10004');
        assert.strictEqual(filteredRes.results[0].title, 'JWTトークン仕様書');
        console.log('  -> OK: 絞り込みCQL検索成功 (正解のみ抽出)');

        // ページ詳細取得
        const pageDetail = await service.getPage('10004');
        assert.strictEqual(pageDetail.id, '10004');
        assert.strictEqual(pageDetail.title, 'JWTトークン仕様書');
        assert(pageDetail.markdown && pageDetail.markdown.includes('RS256'));
        assert(pageDetail.markdown.includes('```http'));
        assert(pageDetail.markdown.includes('署名アルゴリズム') && pageDetail.markdown.includes('RS256'));
        console.log('  -> OK: getPage 正常取得 & Markdown自動変換合格');

        // ノートブックへのインポート検証
        console.log('Test 3: importPageToNotebook の検証 (sources/ へのスタブ配置 & origin付与)');
        let addedFileName = '';
        let addedContent = '';
        let addedOrigin: any = null;

        const mockNotebookManager = {
            addSourceFile: async (id: string, fileName: string, data: any, origin?: any) => {
                addedFileName = fileName;
                addedContent = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
                addedOrigin = origin;
                return {
                    file: { path: `sources/${fileName}`, name: fileName },
                    isConverted: false
                };
            }
        };

        const importRes = await service.importPageToNotebook('nb_test_123', '10004', mockNotebookManager);
        assert(importRes.file);
        assert(addedFileName.startsWith('confluence_10004_'));
        assert(addedFileName.endsWith('.md'));

        // Frontmatter 検証
        assert(addedContent.includes('origin: confluence'));
        assert(addedContent.includes('page_id: "10004"'));
        assert(addedContent.includes('title: "JWTトークン仕様書"'));
        assert(addedContent.includes('space_key: "DEV-ARCH"'));
        assert(addedContent.includes('"2025年リニューアル"'));

        // Origin 検証
        assert(addedOrigin);
        assert.strictEqual(addedOrigin.connectorId, 'confluence');
        assert.strictEqual(addedOrigin.remoteId, '10004');
        assert.strictEqual(addedOrigin.remoteVersion, 'v3');
        assert(addedOrigin.relativeFolder.includes('2025年リニューアル'));
        console.log(`  -> OK: importPageToNotebook 正常 (ファイル名: ${addedFileName}, origin付与確認)`);

    } finally {
        await simulator.stop();
    }

    console.log('=== 全 ConfluenceService 単体テストに合格しました (All tests passed) ===\n');
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
