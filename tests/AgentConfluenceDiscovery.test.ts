import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ConfluenceChaosSimulator } from '../tools/confluence-mock-server';
import { ensureNotebookProject } from '../src/services/NotebookProjectFile';
import { ConfluenceServerConfig } from '../src/types';

const execAsync = promisify(exec);

const testEnv = {
    ...process.env,
    http_proxy: '',
    HTTP_PROXY: '',
    https_proxy: '',
    HTTPS_PROXY: '',
    all_proxy: '',
    ALL_PROXY: '',
    no_proxy: '*'
};

async function runTests() {
    console.log('=== AgentConfluenceDiscovery (AI自律探索＆共通HINTS学習) 結合テスト開始 ===');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainotebook-agent-confluence-'));
    const userRootDir = path.join(tempDir, 'users', 's-ikari');
    const nb1Dir = path.join(userRootDir, 'notebooks', 'nb-auth');
    const nb2Dir = path.join(userRootDir, 'notebooks', 'nb-other');
    const nb3Dir = path.join(userRootDir, 'notebooks', 'nb-wiki-path');
    const userHintsPath = path.join(userRootDir, 'HINTS.md');

    fs.mkdirSync(nb1Dir, { recursive: true });
    fs.mkdirSync(nb2Dir, { recursive: true });
    fs.mkdirSync(nb3Dir, { recursive: true });

    const simulator = new ConfluenceChaosSimulator();
    const port = await simulator.start(0);
    const mockBaseUrl = `http://127.0.0.1:${port}`;

    const confluenceConfig: ConfluenceServerConfig = {
        id: 'mock-server',
        name: 'カオスConfluenceモック',
        baseUrl: mockBaseUrl,
        authType: 'bearer',
        token: 'mock-token',
        defaultSpaceKey: undefined
    };

    try {
        // Step 1: nb1 プロジェクトの初期化 & CLIツールの自動配備
        console.log('Step 1: ensureNotebookProject による .tools/confluence.cjs 自動配備の検証');
        ensureNotebookProject({
            notebookDir: nb1Dir,
            sourcesDir: path.join(nb1Dir, 'sources'),
            artifactsDir: path.join(nb1Dir, 'artifacts'),
            notebookTitle: '認証基盤リサーチ',
            confluenceConfig,
            userHintsPath
        });

        const helperPath = path.join(nb1Dir, '.tools', 'confluence.cjs');
        const configPath = path.join(nb1Dir, '.tools', 'confluence-config.json');
        const claudeMdPath = path.join(nb1Dir, 'CLAUDE.md');

        assert(fs.existsSync(helperPath), '.tools/confluence.cjs が配備されていません');
        assert(fs.existsSync(configPath), '.tools/confluence-config.json が配備されていません');
        assert(fs.existsSync(claudeMdPath), 'CLAUDE.md が生成されていません');

        const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
        assert(claudeMd.includes('.tools/confluence.cjs search'), 'CLAUDE.md に search ツールの説明がありません');
        assert(claudeMd.includes('.tools/confluence.cjs extract'), 'CLAUDE.md に extract ツールの説明がありません');
        assert(claudeMd.includes('.tools/confluence.cjs hint'), 'CLAUDE.md に hint ツールの説明がありません');
        console.log('  -> OK: .tools/confluence.cjs, config, CLAUDE.md ガイドが正常に配備されました');

        // Step 2: CLI 経由での学習前探索 (ノイズ混在)
        console.log('Step 2: CLI 探索 (node .tools/confluence.cjs search "認証") -> 全社ノイズ混在の確認');
        const { stdout: initialSearchOut } = await execAsync('node .tools/confluence.cjs search "認証"', {
            cwd: nb1Dir,
            encoding: 'utf-8',
            env: testEnv
        });

        assert(initialSearchOut.includes('Found'), '検索結果が出力されていません');
        assert(initialSearchOut.includes('PROD-OLD') || initialSearchOut.includes('CORP'), '全社ノイズが含まれていません');
        assert(initialSearchOut.includes('10004'), '正解ドキュメントが含まれていません');
        console.log('  -> OK: 学習前は全社から古い仕様書等のノイズ混在でヒット');

        // Step 3: 人間のフィードバックによる学習 (node .tools/confluence.cjs hint ...)
        console.log('Step 3: 人間の助言を反映した知恵の学習 (node .tools/confluence.cjs hint ...)');
        const hintCmd = [
            'node .tools/confluence.cjs hint',
            '--topic "認証"',
            '--ancestor "10002"',
            '--ancestor-title "2025年リニューアル"',
            '--space "DEV-ARCH"',
            '--guidance "全社検索は古い仕様が多い。2025年リニューアル配下を最優先すること。"'
        ].join(' ');

        const { stdout: hintOut } = await execAsync(hintCmd, { cwd: nb1Dir, encoding: 'utf-8', env: testEnv });
        assert(hintOut.includes('Successfully learned search hint'), '学習成功メッセージが出力されていません');

        // ユーザー共通 HINTS.md に保存されたか確認
        assert(fs.existsSync(userHintsPath), 'ユーザー共通 HINTS.md が作成されていません');
        const userHints = fs.readFileSync(userHintsPath, 'utf-8');
        assert(userHints.includes('DEV-ARCH'), 'HINTS.md に DEV-ARCH がありません');
        assert(userHints.includes('10002'), 'HINTS.md に 10002 がありません');
        console.log('  -> OK: ユーザー共通 HINTS.md に知恵が正常永続化されました');

        // Step 4: 学習後の次回探索 (正解ピンポイントヒット)
        console.log('Step 4: 学習後の次回検索 (node .tools/confluence.cjs search "認証") -> 正解のみ抽出');
        const { stdout: optimizedSearchOut } = await execAsync('node .tools/confluence.cjs search "認証"', {
            cwd: nb1Dir,
            encoding: 'utf-8',
            env: testEnv
        });

        assert(optimizedSearchOut.includes('Applied Search Hint: "認証"'), 'HINTS適用メッセージが出力されていません');
        assert(optimizedSearchOut.includes('10004') && optimizedSearchOut.includes('JWTトークン仕様書'), '正解のJWT仕様書がヒットしていません');
        assert(!optimizedSearchOut.includes('PROD-OLD'), '旧システム（ノイズ）が排除されていません');
        assert(!optimizedSearchOut.includes('CORP'), '総務メモ（ノイズ）が排除されていません');
        console.log('  -> OK: 探索知恵が自動適用され、ノイズが完全排除されて正解のみヒットしました！');

        // Step 5: CLI によるコンテンツ抽出 (extract)
        console.log('Step 5: CLI によるページ抽出 (node .tools/confluence.cjs extract 10004)');
        const { stdout: extractOut } = await execAsync('node .tools/confluence.cjs extract 10004', {
            cwd: nb1Dir,
            encoding: 'utf-8',
            env: testEnv
        });

        assert(extractOut.includes('Successfully extracted page [10004]'), '抽出成功メッセージが出力されていません');

        const extractedFile = path.join(nb1Dir, 'sources', 'confluence_10004_JWTトークン仕様書.md');
        assert(fs.existsSync(extractedFile), 'sources/confluence_10004_JWTトークン仕様書.md が生成されていません');

        const mdContent = fs.readFileSync(extractedFile, 'utf-8');
        assert(mdContent.includes('origin: confluence'), 'frontmatter origin がありません');
        assert(mdContent.includes('page_id: "10004"'), 'frontmatter page_id がありません');
        assert(mdContent.includes('# JWTトークン仕様書'), '見出しタイトルがありません');
        assert(mdContent.includes('```') || mdContent.includes('RS256') || mdContent.includes('Authorization'), '本文の技術仕様が抽出されていません');
        console.log('  -> OK: Storage XML が高精度Markdownに変換され、sources/ に正常保存されました');

        // Step 6: 別の新規ノートブック (nb2) での知恵の自動継承検証
        console.log('Step 6: 別ノートブック (nb2) でのユーザー共通知恵の自動継承検証');
        ensureNotebookProject({
            notebookDir: nb2Dir,
            sourcesDir: path.join(nb2Dir, 'sources'),
            artifactsDir: path.join(nb2Dir, 'artifacts'),
            notebookTitle: '別プロジェクトのノートブック',
            confluenceConfig,
            userHintsPath
        });

        // nb2 にはローカル HINTS.md は存在しない
        assert(!fs.existsSync(path.join(nb2Dir, 'HINTS.md')), 'nb2 にローカルHINTSが誤って存在しています');

        // nb2 から検索実行 -> ユーザー共通 HINTS.md が自動適用される！
        const { stdout: nb2SearchOut } = await execAsync('node .tools/confluence.cjs search "認証"', {
            cwd: nb2Dir,
            encoding: 'utf-8',
            env: testEnv
        });

        assert(nb2SearchOut.includes('Applied Search Hint: "認証"'), 'nb2 で知恵が適用されていません');
        assert(nb2SearchOut.includes('JWTトークン仕様書'), 'nb2 で正解がヒットしていません');
        assert(!nb2SearchOut.includes('PROD-OLD'), 'nb2 でノイズが混在しています');
        console.log('  -> OK: 別ノートブック (nb2) でも初回から探索の知恵が引き継がれ、正解のみヒットしました！');

        // Step 7: コンテキストパス付き baseUrl (例: http://127.0.0.1:port/wiki) での先頭スラッシュ破棄防止検証
        console.log('Step 7: サブパス付き baseUrl (例: /wiki) での URL 結合・先頭スラッシュ破棄防止検証');
        const confluenceConfigWithSubpath: ConfluenceServerConfig = {
            ...confluenceConfig,
            id: 'mock-subpath-server',
            baseUrl: `${mockBaseUrl}/wiki/` // 末尾スラッシュあり・サブパスあり
        };

        ensureNotebookProject({
            notebookDir: nb3Dir,
            sourcesDir: path.join(nb3Dir, 'sources'),
            artifactsDir: path.join(nb3Dir, 'artifacts'),
            notebookTitle: 'サブパスConfluenceノートブック',
            confluenceConfig: confluenceConfigWithSubpath,
            userHintsPath
        });

        // サブパス付き環境での検索実行（先頭 / の endpoint でも /wiki が削ぎ落とされないことの確認）
        const { stdout: nb3SearchOut } = await execAsync('node .tools/confluence.cjs search "認証"', {
            cwd: nb3Dir,
            encoding: 'utf-8',
            env: testEnv
        });

        assert(nb3SearchOut.includes('Found') || nb3SearchOut.includes('JWTトークン仕様書'), 'サブパス環境で検索結果が取得できていません');
        assert(nb3SearchOut.includes('JWTトークン仕様書'), 'サブパス環境で正解がヒットしていません');
        console.log('  -> OK: baseUrl にサブパス (/wiki) が含まれていても URL が正常に解決され検索成功');

        // サブパス付き環境でのページ抽出実行
        const { stdout: nb3ExtractOut } = await execAsync('node .tools/confluence.cjs extract 10004', {
            cwd: nb3Dir,
            encoding: 'utf-8',
            env: testEnv
        });

        assert(nb3ExtractOut.includes('Successfully extracted page [10004]'), 'サブパス環境で抽出に失敗しました');
        const nb3ExtractedFile = path.join(nb3Dir, 'sources', 'confluence_10004_JWTトークン仕様書.md');
        assert(fs.existsSync(nb3ExtractedFile), 'nb3 で抽出ファイルが保存されていません');
        console.log('  -> OK: サブパス環境でもページ抽出が完全に成功しました！');

    } finally {
        await simulator.stop();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }

    console.log('=== 全 AgentConfluenceDiscovery 結合テストに合格しました (All tests passed) ===\n');
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
