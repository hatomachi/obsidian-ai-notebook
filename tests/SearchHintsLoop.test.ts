import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfluenceService } from '../src/services/ConfluenceService';
import { SearchHintsManager } from '../src/services/SearchHintsManager';
import { ConfluenceChaosSimulator } from '../tools/confluence-mock-server';
import { buildClaudeMdContent } from '../src/services/NotebookProjectFile';
import { AINotebookSettings, DEFAULT_SETTINGS } from '../src/types';

async function runTests() {
    console.log('=== SearchHintsLoop (再帰育成学習ループ) 結合テスト開始 ===');

    // テスト用の一時ノートブックディレクトリを作成
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainotebook-hints-test-'));
    const sourcesDir = path.join(tempDir, 'sources');
    const artifactsDir = path.join(tempDir, 'artifacts');
    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });

    // モックサーバー起動
    const simulator = new ConfluenceChaosSimulator();
    const port = await simulator.start(0);
    const mockBaseUrl = `http://localhost:${port}`;

    try {
        const settings: AINotebookSettings = {
            ...DEFAULT_SETTINGS,
            confluenceServers: [
                {
                    id: 'test-confluence',
                    name: '検証用モックConfluence',
                    baseUrl: mockBaseUrl,
                    authType: 'bearer',
                    token: 'dummy-token'
                }
            ],
            defaultConfluenceServerId: 'test-confluence'
        };
        const service = new ConfluenceService(settings);

        // Step 1: 学習前の状態（HINTS.md なし）で検索
        console.log('Step 1: 学習前検索 (text ~ "認証") -> ノイズ混在の確認');
        const initialCqlRes = SearchHintsManager.buildSuggestedCql('認証', tempDir);
        assert.strictEqual(initialCqlRes.cql, 'text ~ "認証"');
        assert.strictEqual(initialCqlRes.matchedHint, undefined);

        const initialSearch = await service.search(initialCqlRes.cql);
        assert(initialSearch.results.length >= 4, `初期検索のヒット件数が不足しています: ${initialSearch.results.length}`);
        const spaces = new Set(initialSearch.results.map(r => r.space?.key));
        assert(spaces.has('PROD-OLD'), '旧システム運用（ノイズ）が含まれていません');
        assert(spaces.has('CORP'), '全社総務（ノイズ）が含まれていません');
        console.log(`  -> OK: 学習前は全社からノイズ混在でヒット (${initialSearch.results.length} 件, スペース: ${Array.from(spaces).join(', ')})`);

        // Step 2: 人間のフィードバックによる学習 (HINTS.md の育成)
        console.log('Step 2: 人間からのフィードバック登録 (HINTS.md へ知恵を記憶)');
        const learnedRule = SearchHintsManager.learnHint(tempDir, {
            topic: '認証',
            keywords: ['認証', 'auth', 'jwt', 'token', 'トークン'],
            spaceKey: 'DEV-ARCH',
            ancestorId: '10002',
            ancestorTitle: '2025年リニューアル',
            guidance: '全社検索はノイズ（古い仕様書や総務メモ）が多いため、必ず2025年リニューアル配下を検索すること。'
        });
        assert(learnedRule.id);

        const hintsPath = path.join(tempDir, 'HINTS.md');
        assert(fs.existsSync(hintsPath), 'HINTS.md が生成されていません');
        const hintsContent = fs.readFileSync(hintsPath, 'utf-8');
        assert(hintsContent.includes('DEV-ARCH'));
        assert(hintsContent.includes('2025年リニューアル'));
        assert(hintsContent.includes('10002'));
        console.log('  -> OK: HINTS.md への永続化完了');

        // Step 3: 次回検索時の自動学習適用
        console.log('Step 3: 学習後の次回検索 (キーワード: "認証トークン") -> 自動最適化 CQL');
        const nextCqlRes = SearchHintsManager.buildSuggestedCql('認証トークン', tempDir);
        assert(nextCqlRes.matchedHint, '学習済みヒントがマッチしていません');
        assert.strictEqual(nextCqlRes.matchedHint.ancestorId, '10002');
        assert.strictEqual(nextCqlRes.cql, 'space = "DEV-ARCH" AND ancestor = "10002" AND text ~ "認証トークン"');
        console.log(`  -> 最適化 CQL 自動生成: ${nextCqlRes.cql}`);

        const optimizedSearch = await service.search(nextCqlRes.cql);
        assert.strictEqual(optimizedSearch.results.length, 1, `絞り込み結果が1件ではありません: ${optimizedSearch.results.length}`);
        assert.strictEqual(optimizedSearch.results[0].id, '10004');
        assert.strictEqual(optimizedSearch.results[0].title, 'JWTトークン仕様書');
        console.log('  -> OK: ノイズが完全に排除され、最新の正解ドキュメント（JWTトークン仕様書）のみが抽出されました！');

        // Step 4: ノートブックへのインポート
        console.log('Step 4: ノートブックの sources/ への取り込み');
        let importedFile = '';
        let importedOrigin: any = null;
        const mockNotebookManager = {
            addSourceFile: async (id: string, fileName: string, data: any, origin?: any) => {
                importedFile = fileName;
                importedOrigin = origin;
                const fullPath = path.join(sourcesDir, fileName);
                fs.writeFileSync(fullPath, data);
                return { file: { path: fullPath, name: fileName } };
            }
        };

        await service.importPageToNotebook('nb_test', '10004', mockNotebookManager);
        assert(fs.existsSync(path.join(sourcesDir, importedFile)));
        assert.strictEqual(importedOrigin.remoteId, '10004');
        console.log(`  -> OK: sources/${importedFile} として正常保存完了`);

        // Step 5: CLAUDE.md / AGENTS.md への HINTS.md 誘導自動注入検証
        console.log('Step 5: buildClaudeMdContent による @HINTS.md 自動注入検証');
        const claudeMd = buildClaudeMdContent({
            notebookDir: tempDir,
            sourcesDir,
            artifactsDir,
            notebookTitle: 'テスト用ノートブック'
        });

        assert(claudeMd.includes('## 🧭 外部ソース探索の知恵 (Search Hints)'), 'Search Hints セクションが存在しません');
        assert(claudeMd.includes('@HINTS.md'), '@HINTS.md の参照指示が含まれていません');
        console.log('  -> OK: CLAUDE.md に @HINTS.md の探索知恵が自動注入されました！');

    } finally {
        await simulator.stop();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    console.log('=== 全 SearchHintsLoop テストに合格しました (All tests passed) ===\n');
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
