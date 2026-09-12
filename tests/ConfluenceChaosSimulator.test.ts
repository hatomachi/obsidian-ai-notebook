import assert from 'assert';
import * as http from 'http';
import { ConfluenceChaosSimulator, generateChaosWikiData } from '../tools/confluence-mock-server';

function httpRequest(urlStr: string): Promise<{ statusCode: number; body: string; json: any }> {
    return new Promise((resolve, reject) => {
        http.get(urlStr, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ statusCode: res.statusCode || 200, body: data, json });
                } catch {
                    resolve({ statusCode: res.statusCode || 200, body: data, json: null });
                }
            });
        }).on('error', reject);
    });
}

async function runTests() {
    console.log('=== ConfluenceChaosSimulator 単体テスト開始 ===');

    // Test 1: カオスデータの自動生成検証
    console.log('Test 1: カオスデータ生成（ゴミ山・ノイズ・正解データの共存）');
    const { pages, spaces } = generateChaosWikiData();
    assert(pages.length >= 95, `生成ページ数が不足しています: ${pages.length}`);
    assert(spaces.length >= 3, `スペース数が不足しています: ${spaces.length}`);

    // 正解データ
    const jwtDoc = pages.find(p => p.id === '10004');
    assert(jwtDoc, 'JWTトークン仕様書が存在しません');
    assert.strictEqual(jwtDoc.title, 'JWTトークン仕様書');
    assert.strictEqual(jwtDoc.spaceKey, 'DEV-ARCH');
    assert(jwtDoc.ancestors.some(a => a.title === '2025年リニューアル'), '2025年リニューアルの階層に存在しません');

    // 旧仕様ノイズ
    const oldDoc = pages.find(p => p.id === '20003');
    assert(oldDoc, '旧認証仕様書が存在しません');
    assert.strictEqual(oldDoc.spaceKey, 'PROD-OLD');

    // 総務ノイズ
    const corpDoc = pages.find(p => p.id === '30003');
    assert(corpDoc, 'セキュリティカード紛失時の認証手続きが存在しません');
    assert.strictEqual(corpDoc.spaceKey, 'CORP');

    console.log(`  -> OK: カオスデータ生成正常 (${pages.length} ページ, ${spaces.length} スペース)`);

    // Test 2: モックサーバー起動 & REST API 互換テスト
    console.log('Test 2: モックサーバー起動 & HTTP 疎通テスト');
    const simulator = new ConfluenceChaosSimulator({ pages, spaces });
    const port = await simulator.start(0);
    assert(port > 0, `無効なポート番号です: ${port}`);
    const baseUrl = `http://localhost:${port}`;
    console.log(`  -> モックサーバー起動完了: ${baseUrl}`);

    try {
        // Space API
        const spaceRes = await httpRequest(`${baseUrl}/rest/api/space`);
        assert.strictEqual(spaceRes.statusCode, 200);
        assert(Array.isArray(spaceRes.json.results));
        assert(spaceRes.json.results.some((s: any) => s.key === 'DEV-ARCH'));
        console.log('  -> OK: /rest/api/space 正常');

        // Search API (ヒントなし・ノイズ混在)
        console.log('Test 3: ヒントなし全社検索 (text ~ "認証") -> ノイズ混在の検証');
        const broadSearchRes = await httpRequest(`${baseUrl}/rest/api/content/search?cql=${encodeURIComponent('text ~ "認証"')}`);
        assert.strictEqual(broadSearchRes.statusCode, 200);
        const broadResults = broadSearchRes.json.results;
        assert(broadResults.length >= 4, `ヒット件数が不足しています: ${broadResults.length}`);

        const spaceKeys = new Set(broadResults.map((r: any) => r.space.key));
        assert(spaceKeys.has('DEV-ARCH'), 'DEV-ARCHが含まれていません');
        assert(spaceKeys.has('PROD-OLD'), 'PROD-OLD（ゴミ山）が含まれていません');
        assert(spaceKeys.has('CORP'), 'CORP（総務ノイズ）が含まれていません');
        console.log(`  -> OK: ノイズ混在検索正常 (ヒット件数: ${broadResults.length}, 複数スペース混在: ${Array.from(spaceKeys).join(', ')})`);

        // Search API (ヒント適用: ancestor = "10002" AND text ~ "認証")
        console.log('Test 4: ヒント適用検索 (ancestor = 10002 AND text ~ "認証") -> 正解ドキュメントのみ抽出の検証');
        const cqlWithHint = 'ancestor = "10002" AND text ~ "認証"';
        const filteredSearchRes = await httpRequest(`${baseUrl}/rest/api/content/search?cql=${encodeURIComponent(cqlWithHint)}`);
        assert.strictEqual(filteredSearchRes.statusCode, 200);
        const filteredResults = filteredSearchRes.json.results;

        assert.strictEqual(filteredResults.length, 1, `正解ドキュメントのみに絞り込めていません (件数: ${filteredResults.length})`);
        assert.strictEqual(filteredResults[0].id, '10004');
        assert.strictEqual(filteredResults[0].title, 'JWTトークン仕様書');
        assert.strictEqual(filteredResults[0].space.key, 'DEV-ARCH');
        console.log('  -> OK: ヒント適用検索によりノイズが完全排除され、JWTトークン仕様書のみが抽出されました');

        // Content API (ページ詳細取得)
        console.log('Test 5: ページ詳細取得 (/rest/api/content/:id) の検証');
        const contentRes = await httpRequest(`${baseUrl}/rest/api/content/10004`);
        assert.strictEqual(contentRes.statusCode, 200);
        const content = contentRes.json;
        assert.strictEqual(content.id, '10004');
        assert.strictEqual(content.title, 'JWTトークン仕様書');
        assert(content.body && content.body.storage && content.body.storage.value);
        assert(content.body.storage.value.includes('RS256'));
        assert.strictEqual(content.version.number, 3);
        console.log('  -> OK: ページ詳細取得正常 (Storage XML 取得成功)');

    } finally {
        await simulator.stop();
        console.log('  -> モックサーバー停止完了');
    }

    console.log('=== 全 ConfluenceChaosSimulator テストに合格しました (All tests passed) ===\n');
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
