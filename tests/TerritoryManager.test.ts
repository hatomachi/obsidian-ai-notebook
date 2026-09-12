import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotebookManager } from '../src/services/NotebookManager';
import { AINotebookSettings, DEFAULT_SETTINGS } from '../src/types';
import { App, FileSystemAdapter, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';

// Simple mock vault implementation backed by a temporary filesystem directory
function createMockVault(tmpDir: string) {
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');

    return {
        adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
            getBasePath: () => tmpDir
        }),
        getAbstractFileByPath: (p: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            if (!fs.existsSync(abs)) return null;
            const stat = fs.statSync(abs);
            if (stat.isDirectory()) {
                const folder = new TFolder();
                folder.path = norm;
                folder.name = path.basename(norm);
                const childrenNames = fs.readdirSync(abs);
                folder.children = childrenNames.map(childName => {
                    const childRel = `${norm}/${childName}`;
                    const childAbs = path.join(abs, childName);
                    const childStat = fs.statSync(childAbs);
                    if (childStat.isDirectory()) {
                        const subFolder = new TFolder();
                        subFolder.path = childRel;
                        subFolder.name = childName;
                        return subFolder;
                    } else {
                        const file = new TFile();
                        file.path = childRel;
                        file.name = childName;
                        file.basename = childName.replace(/\.[^/.]+$/, '');
                        file.extension = path.extname(childName).replace(/^\./, '');
                        file.stat = { size: childStat.size, mtime: childStat.mtimeMs, ctime: childStat.ctimeMs };
                        return file;
                    }
                });
                return folder;
            } else {
                const file = new TFile();
                file.path = norm;
                file.name = path.basename(norm);
                file.basename = file.name.replace(/\.[^/.]+$/, '');
                file.extension = path.extname(norm).replace(/^\./, '');
                file.stat = { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
                return file;
            }
        },
        createFolder: async (p: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(abs, { recursive: true });
        },
        create: async (p: string, content: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, 'utf-8');
            const file = new TFile();
            file.path = norm;
            file.name = path.basename(norm);
            file.basename = file.name.replace(/\.[^/.]+$/, '');
            file.extension = path.extname(norm).replace(/^\./, '');
            return file;
        },
        read: async (file: TFile) => {
            const abs = path.join(tmpDir, normalize(file.path));
            return fs.readFileSync(abs, 'utf-8');
        },
        modify: async (file: TFile, content: string) => {
            const abs = path.join(tmpDir, normalize(file.path));
            fs.writeFileSync(abs, content, 'utf-8');
        },
        createBinary: async (p: string, buffer: ArrayBuffer) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, Buffer.from(buffer));
            const file = new TFile();
            file.path = norm;
            file.name = path.basename(norm);
            return file;
        },
        readBinary: async (file: TFile) => {
            const abs = path.join(tmpDir, normalize(file.path));
            const buf = fs.readFileSync(abs);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        modifyBinary: async (file: TFile, buffer: ArrayBuffer) => {
            const abs = path.join(tmpDir, normalize(file.path));
            fs.writeFileSync(abs, Buffer.from(buffer));
        },
        delete: async (fileOrFolder: any, force?: boolean) => {
            const abs = path.join(tmpDir, normalize(fileOrFolder.path));
            if (fs.existsSync(abs)) {
                fs.rmSync(abs, { recursive: true, force: true });
            }
        }
    };
}

async function runTests() {
    console.log('=== TerritoryManager (縄張りモデル Step 3) 単体テスト開始 ===');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainotebook-territory-test-'));
    const rootDir = '_ainotebook';

    const mockVault = createMockVault(tmpDir);
    const mockApp = { vault: mockVault } as unknown as App;

    const settings: AINotebookSettings = {
        ...DEFAULT_SETTINGS,
        rootDir,
        userName: 'alice' // テスト用ユーザー設定
    };

    const manager = new NotebookManager(mockApp, settings);

    // =========================================================================
    // Test 1: ユーザー名の解決 & サニタイズの検証
    // =========================================================================
    console.log('Test 1: ユーザー名の解決 & サニタイズ');
    assert.strictEqual(manager.getEffectiveUsername(), 'alice', '設定されたユーザー名が返ること');

    const testManagerAuto = new NotebookManager(mockApp, { ...DEFAULT_SETTINGS, userName: '' });
    const autoUser = testManagerAuto.getEffectiveUsername();
    assert.ok(autoUser && autoUser.length > 0, '未設定時にOSユーザー名が推測されること');
    assert.strictEqual(manager.sanitizeUsername('User Name / Test #1'), 'user_name___test__1', '記号や空白がサニタイズされること');
    console.log(`  -> OK: ユーザー名解決・サニタイズ正常 (有効ユーザー: ${autoUser})`);

    // =========================================================================
    // Test 2: 自分の縄張りへの新規ノートブック作成
    // =========================================================================
    console.log('Test 2: 縄張りディレクトリへの新規作成');
    const nb1 = await manager.createNotebook('Alice の企画書', '初期説明');
    assert.strictEqual(nb1.userName, 'alice', 'メタデータに userName が記録されること');

    const loc1 = await manager.resolveNotebookLocation(nb1.id);
    assert.strictEqual(loc1.isLegacy, false, 'レガシーではなく縄張り領域であること');
    assert.strictEqual(loc1.userName, 'alice', 'ロケーションの userName が alice であること');
    assert.strictEqual(loc1.notebookDir, `_ainotebook/users/alice/notebooks/${nb1.id}`, 'ディレクトリが users/alice/ 配下であること');
    assert.strictEqual(loc1.indexPath, `_ainotebook/users/alice/index/${nb1.id}.md`, 'インデックスが users/alice/index/ 配下であること');

    // 実ファイルが存在するか確認
    const absNb1Dir = path.join(tmpDir, loc1.notebookDir);
    const absNb1Index = path.join(tmpDir, loc1.indexPath);
    assert.ok(fs.existsSync(absNb1Dir), '実体フォルダが存在すること');
    assert.ok(fs.existsSync(absNb1Index), 'インデックスファイルが存在すること');
    assert.ok(fs.existsSync(path.join(absNb1Dir, 'sessions')), 'sessions フォルダが存在すること');
    console.log('  -> OK: 縄張りディレクトリへの新規作成正常');

    // =========================================================================
    // Test 3: レガシーノートブックの後方互換性読み込み
    // =========================================================================
    console.log('Test 3: レガシー共有ノートブックの後方互換性');
    const legacyId = 'legacy_nb_999';
    const legacyDir = path.join(tmpDir, rootDir, 'notebooks', legacyId);
    const legacyIndexDir = path.join(tmpDir, rootDir, 'index');
    fs.mkdirSync(path.join(legacyDir, 'sources'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'artifacts'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'sessions'), { recursive: true });
    fs.mkdirSync(legacyIndexDir, { recursive: true });

    const legacyIndexContent = `---\nnotebook_id: "${legacyId}"\ntitle: "共通レガシー仕様書"\ncreated_at: "2026-01-01T00:00:00.000Z"\nupdated_at: "2026-01-01T00:00:00.000Z"\ntags: []\nicon: "book-open"\ndescription: "旧フォルダのノートブック"\n---\n# 共通レガシー仕様書\n`;
    fs.writeFileSync(path.join(legacyIndexDir, `${legacyId}.md`), legacyIndexContent, 'utf-8');

    const allNbs = await manager.getAllNotebooks();
    const foundLegacy = allNbs.find(n => n.id === legacyId);
    assert.ok(foundLegacy, 'レガシーノートブックが一覧に含まれること');
    assert.strictEqual(foundLegacy?.title, '共通レガシー仕様書');
    assert.strictEqual(foundLegacy?.userName, undefined, 'レガシーは userName が未設定（共有扱い）であること');

    const legacyLoc = await manager.resolveNotebookLocation(legacyId);
    assert.strictEqual(legacyLoc.isLegacy, true, 'isLegacy が true であること');
    assert.strictEqual(legacyLoc.notebookDir, `_ainotebook/notebooks/${legacyId}`);
    console.log('  -> OK: レガシー共有ノートブックの読み込み合格');

    // =========================================================================
    // Test 4: 他人（Bob）の縄張りノートブックの認識とフォーク
    // =========================================================================
    console.log('Test 4: 他人の縄張りノートブックの認識 & フォーク');
    const bobId = 'bob_nb_001';
    const bobUserBase = path.join(tmpDir, rootDir, 'users', 'bob');
    const bobDir = path.join(bobUserBase, 'notebooks', bobId);
    fs.mkdirSync(path.join(bobDir, 'sources'), { recursive: true });
    fs.mkdirSync(path.join(bobDir, 'artifacts'), { recursive: true });
    fs.mkdirSync(path.join(bobDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(bobUserBase, 'index'), { recursive: true });

    // Bobの成果物を1つ作成
    fs.writeFileSync(path.join(bobDir, 'artifacts', 'bob_design.md'), '# Bob Design Document', 'utf-8');

    const bobIndexContent = `---\nnotebook_id: "${bobId}"\ntitle: "Bob のアーキテクチャ設計"\ncreated_at: "2026-02-01T00:00:00.000Z"\nupdated_at: "2026-02-01T00:00:00.000Z"\nuser_name: "bob"\ntags: []\nicon: "cpu"\ndescription: "Bobの縄張り"\n---\n# Bob のアーキテクチャ設計\n`;
    fs.writeFileSync(path.join(bobUserBase, 'index', `${bobId}.md`), bobIndexContent, 'utf-8');

    const allWithBob = await manager.getAllNotebooks();
    const foundBob = allWithBob.find(n => n.id === bobId);
    assert.ok(foundBob, 'Bobのノートブックが一覧に含まれること');
    assert.strictEqual(foundBob?.userName, 'bob', 'userName が bob であること');

    // Alice が Bob のノートブックをフォーク
    const forked = await manager.forkNotebook(bobId);
    assert.ok(forked, 'フォークが成功すること');
    assert.notStrictEqual(forked.id, bobId, 'フォーク後は新しいIDが採番されること');
    assert.strictEqual(forked.userName, 'alice', 'フォーク後の所有者は alice になること');
    assert.ok(forked.title.includes('Bob のアーキテクチャ設計'), 'タイトルが引き継がれること');

    const forkedLoc = await manager.resolveNotebookLocation(forked.id);
    assert.strictEqual(forkedLoc.notebookDir, `_ainotebook/users/alice/notebooks/${forked.id}`, 'フォーク先が alice の縄張りであること');

    // Bobの成果物ファイルがAliceの縄張りにコピーされているか確認
    const copiedArtifactPath = path.join(tmpDir, forkedLoc.notebookDir, 'artifacts', 'bob_design.md');
    assert.ok(fs.existsSync(copiedArtifactPath), '成果物ファイルがフォーク先にコピーされていること');
    console.log('  -> OK: 他人の縄張りノートブック認識 & フォーク合格');

    // =========================================================================
    // Test 5: レガシーノートブックを自分の縄張りに移行 (Migrate)
    // =========================================================================
    console.log('Test 5: レガシーノートブックの縄張り移行 (Migrate)');
    const migrated = await manager.migrateNotebookToUser(legacyId);
    assert.strictEqual(migrated.userName, 'alice', '移行後の所有者が alice になること');

    const migratedLoc = await manager.resolveNotebookLocation(legacyId);
    assert.strictEqual(migratedLoc.isLegacy, false, '移行後はレガシーではなく縄張りであること');
    assert.strictEqual(migratedLoc.notebookDir, `_ainotebook/users/alice/notebooks/${legacyId}`, '実体が alice の縄張りに移動していること');
    assert.strictEqual(migratedLoc.indexPath, `_ainotebook/users/alice/index/${legacyId}.md`, 'インデックスが alice の縄張りに移動していること');

    // 旧パス（レガシー領域）からファイルが削除されていること
    assert.ok(!fs.existsSync(legacyDir), '旧レガシー実体フォルダが削除されていること');
    assert.ok(!fs.existsSync(path.join(legacyIndexDir, `${legacyId}.md`)), '旧レガシーインデックスが削除されていること');
    console.log('  -> OK: 縄張り移行 (Migrate) 合格');

    // クリーンアップ
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('=== 全 TerritoryManager 単体テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
