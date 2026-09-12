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

        assert(claudeMd.includes('Search Hints'), 'Search Hints セクションが存在しません');
        assert(claudeMd.includes('@HINTS.md'), '@HINTS.md の参照指示が含まれていません');
        console.log('  -> OK: CLAUDE.md に @HINTS.md の探索知恵が自動注入されました！');

        // Step 6: ユーザー共通 HINTS.md と ノートブック固有 HINTS.md の2層化マージ検証
        console.log('Step 6: ユーザー共通 HINTS.md と ノートブック固有 HINTS.md の2層化マージ検証');
        const userRootDir = path.join(tempDir, 'users', 'alice');
        const nb1Dir = path.join(userRootDir, 'notebooks', 'nb1');
        const nb2Dir = path.join(userRootDir, 'notebooks', 'nb2');
        fs.mkdirSync(nb1Dir, { recursive: true });
        fs.mkdirSync(nb2Dir, { recursive: true });

        // nb1 から学習 -> ユーザー共通 users/alice/HINTS.md に保存される
        SearchHintsManager.learnHint(nb1Dir, {
            topic: '課金',
            keywords: ['課金', 'billing', '決済'],
            spaceKey: 'BILLING',
            ancestorId: '20001',
            ancestorTitle: '決済基盤',
            guidance: '課金関係はBILLINGスペース配下を検索'
        });

        const userHintsPath = path.join(userRootDir, 'HINTS.md');
        assert(fs.existsSync(userHintsPath), 'users/alice/HINTS.md が生成されていません');
        const userHintsContent = fs.readFileSync(userHintsPath, 'utf-8');
        assert(userHintsContent.includes('BILLING'));
        assert(userHintsContent.includes('20001'));

        // nb2 には HINTS.md がないが、ユーザー共通の知恵が自動で効く
        const nb2QueryRes = SearchHintsManager.buildSuggestedCql('決済仕様', nb2Dir);
        assert(nb2QueryRes.matchedHint, 'nb2 でユーザー共通ヒントがマッチしていません');
        assert.strictEqual(nb2QueryRes.matchedHint.spaceKey, 'BILLING');
        assert.strictEqual(nb2QueryRes.matchedHint.ancestorId, '20001');
        assert.strictEqual(nb2QueryRes.cql, 'space = "BILLING" AND ancestor = "20001" AND text ~ "決済仕様"');
        console.log('  -> OK: nb2 (ローカルHINTSなし) でもユーザー共通の探索知恵が自動継承されました！');

        // nb2 固有スコープで学習 -> nb2/HINTS.md にのみ保存され、マージされる
        SearchHintsManager.learnHint(nb2Dir, {
            topic: 'インフラ',
            keywords: ['インフラ', 'k8s', 'terraform'],
            spaceKey: 'INFRA',
            ancestorId: '30001',
            ancestorTitle: 'EKSクラスタ構成',
            guidance: 'nb2プロジェクト固有のインフラ情報'
        }, { scope: 'notebook' });

        const nb2HintsPath = path.join(nb2Dir, 'HINTS.md');
        assert(fs.existsSync(nb2HintsPath), 'nb2/HINTS.md が生成されていません');
        // ユーザー共通には「インフラ」が含まれていないことを確認
        assert(!fs.readFileSync(userHintsPath, 'utf-8').includes('INFRA'), 'ユーザー共通にノートブック固有ルールが漏洩しています');

        // nb2 から検索すると「課金」(user) も「インフラ」(notebook) も両方利用可能
        const nb2InfraRes = SearchHintsManager.buildSuggestedCql('k8s設定', nb2Dir);
        assert(nb2InfraRes.matchedHint, 'nb2 でノートブック固有ヒントがマッチしていません');
        assert.strictEqual(nb2InfraRes.matchedHint.spaceKey, 'INFRA');
        assert.strictEqual(nb2InfraRes.matchedHint.scope, 'notebook');

        const nb2BillingRes = SearchHintsManager.buildSuggestedCql('課金', nb2Dir);
        assert(nb2BillingRes.matchedHint, 'nb2 でユーザー共通ヒントがマッチしていません');
        assert.strictEqual(nb2BillingRes.matchedHint.spaceKey, 'BILLING');
        console.log('  -> OK: ユーザー共通とノートブック固有の階層マージが正常に機能しています！');

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
