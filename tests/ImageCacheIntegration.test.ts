import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClaudeMdContent } from '../src/services/NotebookProjectFile';
import { NotebookManager } from '../src/services/NotebookManager';
import { App, FileSystemAdapter } from 'obsidian';

async function runTests() {
    console.log('=== ImageCacheIntegration 単体テスト開始 ===');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainotebook-cache-test-'));
    const rootDir = '_ainotebook';
    const nbId = 'test_nb_image_01';
    const nbDir = path.join(tmpDir, rootDir, 'notebooks', nbId);
    const sourcesDir = path.join(nbDir, 'sources');
    const artifactsDir = path.join(nbDir, 'artifacts');

    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });

    // Mock App & Vault
    const mockApp = {
        vault: {
            adapter: {
                getBasePath: () => tmpDir,
                writeBinary: async () => {},
                read: async () => '',
            },
            getAbstractFileByPath: (p: string) => null,
            createFolder: async (p: string) => {},
            create: async (p: string, c: string) => ({ path: p }),
            modify: async () => {},
            createBinary: async (p: string, d: ArrayBuffer) => ({ path: p }),
            modifyBinary: async () => {},
        }
    } as unknown as App;

    // FileSystemAdapter のモック判定を通過させる
    Object.setPrototypeOf(mockApp.vault.adapter, FileSystemAdapter.prototype);

    const mockSettings = {
        rootDir: rootDir,
        compressImages: true,
        imageQuality: 0.8,
        imageMaxDimension: 1200
    } as any;

    // Mock GitLabService
    let downloadCallCount = 0;
    const mockGitLabService = {
        isUploadsEnabled: () => true,
        getServerForUrl: () => ({ id: 'srv1', baseUrl: 'https://gitlab.example.com', token: 'glpat-test' }),
        downloadFile: async (url: string) => {
            downloadCallCount++;
            return new TextEncoder().encode('fake-webp-data').buffer;
        }
    } as any;

    const manager = new NotebookManager(mockApp, mockSettings, mockGitLabService);

    // -------------------------------------------------------------
    // Test 1: saveImageToCache と .gitignore の自動生成
    // -------------------------------------------------------------
    console.log('Test 1: saveImageToCache と .gitignore の自動生成');
    const dummyBuffer = new TextEncoder().encode('webp-binary-content').buffer;
    const savedPath = await manager.saveImageToCache(nbId, 'sample.webp', dummyBuffer);

    assert.ok(fs.existsSync(savedPath), 'キャッシュファイルがディスク上に生成されていること');
    const gitignorePath = path.join(sourcesDir, '.cache', '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), 'sources/.cache/.gitignore が生成されていること');
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    assert.ok(gitignoreContent.includes('*'), '.gitignore に全無視ルールが含まれていること');
    assert.ok(gitignoreContent.includes('!.gitignore'), '.gitignore 自身は除外されていること');
    assert.strictEqual(manager.isImageCached(nbId, 'sample.webp'), true, 'isImageCached が true を返すこと');
    assert.strictEqual(manager.isImageCached(nbId, 'non_existent.webp'), false, '未存在ファイルで false を返すこと');
    console.log('  -> OK: キャッシュ保存と .gitignore 正常生成');

    // -------------------------------------------------------------
    // Test 2: CLAUDE.md / AGENTS.md への画像キャッシュ誘導セクション生成
    // -------------------------------------------------------------
    console.log('Test 2: buildClaudeMdContent での画像キャッシュ誘導セクション生成');
    // sources/ に画像メタデータ Markdown を作成
    const metaMdContent = `---
type: gitlab_image
original_name: "architecture.png"
webp_name: "sample.webp"
gitlab_url: "https://gitlab.example.com/api/v4/projects/123/uploads/abc/sample.webp"
original_size: 500000
compressed_size: 45000
compression_ratio: 91
uploaded_at: "2026-09-12T10:00:00.000Z"
---

# 🖼️ architecture.png
`;
    fs.writeFileSync(path.join(sourcesDir, 'sample.webp.md'), metaMdContent, 'utf-8');

    const claudeMd = buildClaudeMdContent({
        notebookDir: nbDir,
        sourcesDir: sourcesDir,
        artifactsDir: artifactsDir,
        notebookTitle: 'キャッシュ検証ノートブック'
    });

    assert.ok(claudeMd.includes('### 🖼️ 画像ソースのローカルキャッシュ (sources/.cache/images/)'), '画像キャッシュセクションが出力されていること');
    assert.ok(claudeMd.includes('sources/.cache/images/sample.webp'), 'キャッシュ画像のパスが明記されていること');
    assert.ok(claudeMd.includes('原本: architecture.png'), '原本ファイル名が出力されていること');
    assert.ok(claudeMd.includes('Read ツール等で直接読み込んでください'), 'マルチモーダル視覚認識の誘導が含まれていること');
    // sources/ 一般一覧に .cache や .gitignore が混ざっていないこと
    const inputSection = claudeMd.slice(claudeMd.indexOf('## インプット (sources/)'), claudeMd.indexOf('### 🖼️ 画像ソース'));
    assert.ok(!inputSection.includes('sources/.cache'), 'インプット一覧に .cache が混ざっていないこと');
    assert.ok(!inputSection.includes('.gitignore'), 'インプット一覧に .gitignore が混ざっていないこと');
    console.log('  -> OK: CLAUDE.md 誘導セクション正常生成');

    // -------------------------------------------------------------
    // Test 3: ensureImageCache によるオンデマンド自動復元
    // -------------------------------------------------------------
    console.log('Test 3: ensureImageCache によるオンデマンド自動復元');
    // 別の画像メタデータを作成（キャッシュ未生成状態）
    const metaMd2 = `---
type: gitlab_image
original_name: "flowchart.jpg"
webp_name: "flowchart.webp"
gitlab_url: "https://gitlab.example.com/api/v4/projects/123/uploads/def/flowchart.webp"
---
`;
    fs.writeFileSync(path.join(sourcesDir, 'flowchart.webp.md'), metaMd2, 'utf-8');

    assert.strictEqual(manager.isImageCached(nbId, 'flowchart.webp'), false, '復元前はキャッシュなし');
    downloadCallCount = 0;

    const restoreResult = await manager.ensureImageCache(nbId);
    assert.strictEqual(restoreResult.restored.length, 1, '1件復元されたこと');
    assert.strictEqual(restoreResult.restored[0], 'flowchart.webp');
    assert.strictEqual(downloadCallCount, 1, 'GitLabService.downloadFile が1回呼ばれたこと');
    assert.strictEqual(manager.isImageCached(nbId, 'flowchart.webp'), true, '復元後はキャッシュが存在すること');

    // 再度 ensureImageCache を呼んでも既に存在するのでスキップされること
    const secondResult = await manager.ensureImageCache(nbId);
    assert.strictEqual(secondResult.restored.length, 0, 'キャッシュ済みのため再ダウンロードされないこと');
    assert.strictEqual(downloadCallCount, 1, 'downloadFile の呼び出し回数が増えていないこと');
    console.log('  -> OK: オンデマンド自動復元およびキャッシュ判定正常');

    // 一時ディレクトリのクリーンアップ
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('=== 全 ImageCacheIntegration 単体テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
