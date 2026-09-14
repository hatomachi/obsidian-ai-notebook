import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ConfluenceChaosSimulator, DUMMY_PNG_BUFFER } from '../tools/confluence-mock-server';
import { confluenceHtmlToMarkdown } from '../src/services/confluence/ConfluenceHtmlToMarkdown';
import { getConfluenceHelperScript } from '../src/services/confluence/confluenceHelperTemplate';
import { ConfluenceService } from '../src/services/ConfluenceService';
import { AINotebookSettings } from '../src/types';

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
    console.log('=== ConfluenceImageExtract (画像完全自動取得) 単体・結合テスト開始 ===');

    // -------------------------------------------------------------
    // Test 1: ConfluenceHtmlToMarkdown の画像タグパース機能検証
    // -------------------------------------------------------------
    console.log('Test 1: ConfluenceHtmlToMarkdown 画像タグ変換の検証');
    {
        // 添付ファイル画像 (キャプションあり, imageDirPrefix あり)
        const htmlWithCaption = `
            <h1>システム構成</h1>
            <p>
                <ac:image ac:align="center">
                    <ri:attachment ri:filename="arch.png" />
                    <ac:caption><p>構成概要図</p></ac:caption>
                </ac:image>
            </p>
        `;
        const md1 = confluenceHtmlToMarkdown(htmlWithCaption, { imageDirPrefix: './confluence_10004_images' });
        assert(md1.includes('![構成概要図](./confluence_10004_images/arch.png)'), 'キャプション付き添付画像リンクが正しくありません: ' + md1);

        // 添付ファイル画像 (キャプションなし, imageDirPrefix なし)
        const htmlNoCaption = `
            <ac:image>
                <ri:attachment ri:filename="database.png" />
            </ac:image>
        `;
        const md2 = confluenceHtmlToMarkdown(htmlNoCaption);
        assert(md2.includes('![database.png](database.png)'), 'キャプションなし添付画像リンクが正しくありません: ' + md2);

        // 外部URL画像
        const htmlUrl = `
            <ac:image>
                <ri:url ri:value="https://example.com/logo.png" />
                <ac:caption><p>ロゴマーク</p></ac:caption>
            </ac:image>
        `;
        const md3 = confluenceHtmlToMarkdown(htmlUrl);
        assert(md3.includes('![ロゴマーク](https://example.com/logo.png)'), '外部URL画像リンクが正しくありません: ' + md3);

        // 標準 <img> タグ
        const htmlImg = '<p>見出し</p><img src="https://example.com/icon.svg" alt="アイコン" />';
        const md4 = confluenceHtmlToMarkdown(htmlImg);
        assert(md4.includes('![アイコン](https://example.com/icon.svg)'), 'imgタグ変換が正しくありません: ' + md4);

        console.log('  -> OK: ConfluenceHtmlToMarkdown 画像タグ変換正常');
    }

    // -------------------------------------------------------------
    // Test 2: CLI ヘルパー (.tools/confluence.cjs) による自動画像ダウンロード検証
    // -------------------------------------------------------------
    console.log('Test 2: CLI ヘルパー (.tools/confluence.cjs extract) の画像自動取得検証');
    const simulator = new ConfluenceChaosSimulator();
    const port = await simulator.start(0);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'confluence-img-test-'));

    try {
        const notebookDir = path.join(tempDir, 'test_notebook');
        const toolsDir = path.join(notebookDir, '.tools');
        fs.mkdirSync(toolsDir, { recursive: true });

        // .tools/confluence.cjs を配備
        const script = getConfluenceHelperScript();
        fs.writeFileSync(path.join(toolsDir, 'confluence.cjs'), script, { mode: 0o755 });

        // .tools/confluence-config.json を配備
        const config = {
            baseUrl: `http://127.0.0.1:${port}`,
            token: 'mock-token',
            authType: 'bearer'
        };
        fs.writeFileSync(path.join(toolsDir, 'confluence-config.json'), JSON.stringify(config, null, 2));

        // (A) 画像添付があるページ (ID: 10004 - JWTトークン仕様書) の抽出
        console.log('  -> (A) 画像ありページの抽出実行 (ID: 10004)');
        const cmd1 = `node .tools/confluence.cjs extract 10004`;
        const { stdout: output1 } = await execAsync(cmd1, { cwd: notebookDir, encoding: 'utf-8', env: testEnv });

        assert(output1.includes('Extracting page [ID: 10004]'), '抽出ログが出力されていません');
        assert(output1.includes('Images: 1 image(s) downloaded'), '画像ダウンロードログが出力されていません: ' + output1);

        const sourcesDir = path.join(notebookDir, 'sources');
        assert(fs.existsSync(sourcesDir), 'sources/ ディレクトリが存在しません');

        // 画像フォルダ & 画像ファイルの検証
        const imageFolder = path.join(sourcesDir, 'confluence_10004_images');
        assert(fs.existsSync(imageFolder), 'confluence_10004_images フォルダが存在しません');

        const imgFile = path.join(imageFolder, 'jwt_auth_flow.png');
        assert(fs.existsSync(imgFile), '画像ファイル jwt_auth_flow.png が保存されていません');
        const imgBuffer = fs.readFileSync(imgFile);
        assert(imgBuffer.equals(DUMMY_PNG_BUFFER), '保存された画像データが一致しません');

        // Markdown ファイルの画像リンク検証
        const files = fs.readdirSync(sourcesDir);
        const mdFile = files.find(f => f.startsWith('confluence_10004_') && f.endsWith('.md'));
        assert(mdFile, 'Markdown ファイルが生成されていません');

        const mdContent = fs.readFileSync(path.join(sourcesDir, mdFile!), 'utf-8');
        assert(
            mdContent.includes('![JWT認証・認可シーケンスフロー図](./confluence_10004_images/jwt_auth_flow.png)'),
            'Markdown 内の画像リンクが相対パスに置換されていません: ' + mdContent
        );
        console.log('  -> OK: 画像ありページの自動ダウンロード・相対パス置換正常');

        // (B) 画像添付がないページ (ID: 10005 - ユーザー認可ロール定義) の抽出
        console.log('  -> (B) 画像なしページの抽出実行 (ID: 10005)');
        const cmd2 = `node .tools/confluence.cjs extract 10005`;
        const { stdout: output2 } = await execAsync(cmd2, { cwd: notebookDir, encoding: 'utf-8', env: testEnv });

        assert(output2.includes('Extracting page [ID: 10005]'), '抽出ログが出力されていません');
        assert(!output2.includes('Images:'), '画像なしページで画像ログが出力されています');

        const noImageFolder = path.join(sourcesDir, 'confluence_10005_images');
        assert(!fs.existsSync(noImageFolder), '画像がないのに空の画像フォルダが作成されています');

        const mdFile2 = fs.readdirSync(sourcesDir).find(f => f.startsWith('confluence_10005_') && f.endsWith('.md'));
        assert(mdFile2, '画像なしページの Markdown ファイルが生成されていません');
        console.log('  -> OK: 画像なしページで空フォルダが作成されず正常終了');

    } finally {
        await simulator.stop();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    // -------------------------------------------------------------
    // Test 3: ConfluenceService (Obsidian UI側) の画像自動インポート検証
    // -------------------------------------------------------------
    console.log('Test 3: ConfluenceService.importPageToNotebook の画像自動インポート検証');
    const simulator2 = new ConfluenceChaosSimulator();
    const port2 = await simulator2.start(0);

    try {
        const settings: AINotebookSettings = {
            rootDir: '_ainotebook',
            confluenceServers: [
                {
                    id: 'mock-confluence',
                    name: 'Mock Confluence',
                    baseUrl: `http://127.0.0.1:${port2}`,
                    token: 'mock-token',
                    authType: 'bearer',
                    connectionMode: 'direct'
                }
            ],
            defaultConfluenceServerId: 'mock-confluence'
        } as any;

        const confluenceService = new ConfluenceService(settings);

        const savedFiles: { fileName: string; data: any; subfolder?: string; origin?: any }[] = [];
        const mockNotebookManager = {
            addSourceFile: async (_id: string, fileName: string, data: any, origin?: any, subfolder?: string) => {
                savedFiles.push({ fileName, data, subfolder, origin });
                return { file: null, isConverted: false, isOffloaded: false };
            }
        };

        await confluenceService.importPageToNotebook('test_nb', '10004', mockNotebookManager);

        // 1. 画像がサブフォルダ付きで保存されたか
        const imageEntry = savedFiles.find(f => f.fileName === 'jwt_auth_flow.png');
        assert(imageEntry, 'jwt_auth_flow.png が保存されていません');
        assert(imageEntry.subfolder === 'confluence_10004_images', `サブフォルダが不正です: ${imageEntry.subfolder}`);
        assert(Buffer.isBuffer(imageEntry.data), '保存データが Buffer ではありません');
        assert((imageEntry.data as Buffer).equals(DUMMY_PNG_BUFFER), '保存された画像データが一致しません');

        // 2. Markdown 本文が相対リンク付きで保存されたか
        const mdEntry = savedFiles.find(f => f.fileName.startsWith('confluence_10004_'));
        assert(mdEntry, 'Markdown 本文が保存されていません');
        const mdText = mdEntry.data as string;
        assert(
            mdText.includes('![JWT認証・認可シーケンスフロー図](./confluence_10004_images/jwt_auth_flow.png)'),
            'Markdown 内の画像リンクが相対パスに置換されていません: ' + mdText
        );
        assert(mdText.includes('images_folder: "confluence_10004_images"'), 'frontmatter に images_folder がありません');
        assert(mdText.includes('images_count: 1'), 'frontmatter に images_count がありません');

        console.log('  -> OK: ConfluenceService による画像自動保存および Markdown 相対リンク置換正常');
    } finally {
        await simulator2.stop();
    }

    console.log('=== 全 ConfluenceImageExtract テストに合格しました (All tests passed) ===\n');
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
