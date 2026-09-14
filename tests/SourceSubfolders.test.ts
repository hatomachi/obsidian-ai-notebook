import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotebookManager } from '../src/services/NotebookManager';
import { buildClaudeMdContent } from '../src/services/NotebookProjectFile';
import { AINotebookSettings, DEFAULT_SETTINGS } from '../src/types';
import { App, FileSystemAdapter, TFile, TFolder, parseYaml, stringifyYaml } from 'obsidian';

// Simple mock vault implementation backed by a temporary filesystem directory
function createMockVault(tmpDir: string) {
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '');

    const vault: any = {
        adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
            getBasePath: () => tmpDir
        }),
        getAbstractFileByPath: (p: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            if (!fs.existsSync(abs)) return null;
            const stat = fs.statSync(abs);
            if (stat.isDirectory()) {
                const makeFolder = (normPath: string, absPath: string): TFolder => {
                    const folder = new TFolder();
                    folder.path = normPath;
                    folder.name = path.basename(normPath);
                    const childrenNames = fs.readdirSync(absPath);
                    folder.children = childrenNames.map(childName => {
                        const childRel = `${normPath}/${childName}`;
                        const childAbs = path.join(absPath, childName);
                        const childStat = fs.statSync(childAbs);
                        if (childStat.isDirectory()) {
                            return makeFolder(childRel, childAbs);
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
                };
                return makeFolder(norm, abs);
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
        create: async (p: string, data: string) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, data, 'utf-8');
            return vault.getAbstractFileByPath(norm);
        },
        createBinary: async (p: string, data: ArrayBuffer) => {
            const norm = normalize(p);
            const abs = path.join(tmpDir, norm);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, Buffer.from(data));
            return vault.getAbstractFileByPath(norm);
        },
        modify: async (file: TFile, data: string) => {
            const abs = path.join(tmpDir, file.path);
            fs.writeFileSync(abs, data, 'utf-8');
        },
        read: async (file: TFile) => {
            const abs = path.join(tmpDir, file.path);
            return fs.readFileSync(abs, 'utf-8');
        },
        readBinary: async (file: TFile) => {
            const abs = path.join(tmpDir, file.path);
            const buf = fs.readFileSync(abs);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
        delete: async (file: any, force?: boolean) => {
            const abs = path.join(tmpDir, file.path);
            if (fs.existsSync(abs)) {
                fs.rmSync(abs, { recursive: true, force: true });
            }
        }
    };

    const fileManager: any = {
        renameFile: async (file: any, newPath: string) => {
            const oldAbs = path.join(tmpDir, file.path);
            const newAbs = path.join(tmpDir, normalize(newPath));
            fs.mkdirSync(path.dirname(newAbs), { recursive: true });
            fs.renameSync(oldAbs, newAbs);
            file.path = normalize(newPath);
            file.name = path.basename(newPath);
        }
    };

    return { vault, fileManager };
}

async function runTests() {
    console.log('=== sources/ サブフォルダ管理 & AI自律探索 単体テスト開始 ===');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-subfolders-test-'));

    try {
        const { vault, fileManager } = createMockVault(tmpDir);
        const app: any = { vault, fileManager };

        const settings: AINotebookSettings = {
            ...DEFAULT_SETTINGS,
            rootDir: '_ainotebook',
            userName: 'alice'
        };

        const manager = new NotebookManager(app, settings);
        await manager.ensureBaseDirectories();

        // ノートブックを作成
        const nb = await manager.createNotebook('基幹システム刷新プロジェクト');
        const nbId = nb.id;
        console.log(`  -> ノートブック作成完了: ${nbId}`);

        // -------------------------------------------------------------
        console.log('Test 1: createSourceFolder によるサブフォルダ作成');
        await manager.createSourceFolder(nbId, '01_ヒアリング');
        await manager.createSourceFolder(nbId, '02_現行仕様');
        await manager.createSourceFolder(nbId, '03_見積/v1');

        const folders = await manager.getSourceFolders(nbId);
        assert.deepStrictEqual(folders, ['01_ヒアリング', '02_現行仕様', '03_見積', '03_見積/v1']);
        console.log('  -> OK: サブフォルダ一覧正常取得:', folders);

        // -------------------------------------------------------------
        console.log('Test 2: addSourceFile（サブフォルダ指定 & 直下混在）');
        // 直下にファイル追加
        await manager.addSourceFile(nbId, 'root_overview.md', '# プロジェクト概要\n全体像です。');
        
        // サブフォルダ配下に追加
        await manager.addSourceFile(nbId, '2026-09-10_ヒアリング.md', '# ヒアリング議事録\n要件メモ', undefined, '01_ヒアリング');
        await manager.addSourceFile(nbId, 'apigw_spec.md', '# API仕様書\nv1 endpoints', undefined, '02_現行仕様');

        const sources = await manager.getSources(nbId);
        assert.strictEqual(sources.length, 3, '合計3件のソースが取得できること');

        const rootSrc = sources.find(s => s.name === 'root_overview.md');
        assert.ok(rootSrc, '直下のソースが存在すること');
        assert.strictEqual(rootSrc.subfolder, undefined, '直下ソースの subfolder は undefined');
        assert.strictEqual(rootSrc.relativePath, 'root_overview.md');

        const hearingSrc = sources.find(s => s.name === '2026-09-10_ヒアリング.md');
        assert.ok(hearingSrc, 'サブフォルダ内のソースが存在すること');
        assert.strictEqual(hearingSrc.subfolder, '01_ヒアリング');
        assert.strictEqual(hearingSrc.relativePath, '01_ヒアリング/2026-09-10_ヒアリング.md');

        const specSrc = sources.find(s => s.name === 'apigw_spec.md');
        assert.ok(specSrc);
        assert.strictEqual(specSrc.subfolder, '02_現行仕様');
        assert.strictEqual(specSrc.relativePath, '02_現行仕様/apigw_spec.md');
        console.log('  -> OK: 直下とサブフォルダの相対パスおよび subfolder が正しく解決されました');

        // -------------------------------------------------------------
        console.log('Test 3: moveSourceFile によるフォルダ間移動');
        // root_overview.md を 01_ヒアリング 配下へ移動
        await manager.moveSourceFile(nbId, 'root_overview.md', '01_ヒアリング');
        let updatedSources = await manager.getSources(nbId);
        const movedSrc = updatedSources.find(s => s.name === 'root_overview.md');
        assert.ok(movedSrc);
        assert.strictEqual(movedSrc.subfolder, '01_ヒアリング');
        assert.strictEqual(movedSrc.relativePath, '01_ヒアリング/root_overview.md');

        // 再び直下（null）へ移動
        await manager.moveSourceFile(nbId, '01_ヒアリング/root_overview.md', null);
        updatedSources = await manager.getSources(nbId);
        const backSrc = updatedSources.find(s => s.name === 'root_overview.md');
        assert.ok(backSrc);
        assert.strictEqual(backSrc.subfolder, undefined);
        assert.strictEqual(backSrc.relativePath, 'root_overview.md');
        console.log('  -> OK: ファイルのフォルダ間移動が正常に動作しました');

        // -------------------------------------------------------------
        console.log('Test 4: renameSourceFolder によるサブフォルダ名変更');
        await manager.renameSourceFolder(nbId, '01_ヒアリング', '01_要件ヒアリング');
        const renamedFolders = await manager.getSourceFolders(nbId);
        assert.ok(renamedFolders.includes('01_要件ヒアリング'));
        assert.ok(!renamedFolders.includes('01_ヒアリング'));

        const sourcesAfterRename = await manager.getSources(nbId);
        const renamedSrc = sourcesAfterRename.find(s => s.name === '2026-09-10_ヒアリング.md');
        assert.ok(renamedSrc);
        assert.strictEqual(renamedSrc.subfolder, '01_要件ヒアリング');
        assert.strictEqual(renamedSrc.relativePath, '01_要件ヒアリング/2026-09-10_ヒアリング.md');
        console.log('  -> OK: フォルダ名リネームと配下ファイルのパス追従正常');

        // -------------------------------------------------------------
        console.log('Test 5: deleteSourceFolder によるフォルダ削除（配下ファイルを直下に退避）');
        await manager.deleteSourceFolder(nbId, '01_要件ヒアリング', true);
        const foldersAfterDel = await manager.getSourceFolders(nbId);
        assert.ok(!foldersAfterDel.includes('01_要件ヒアリング'));

        const sourcesAfterDel = await manager.getSources(nbId);
        const rescuedSrc = sourcesAfterDel.find(s => s.name === '2026-09-10_ヒアリング.md');
        assert.ok(rescuedSrc, '配下のファイルが直下に退避されて残っていること');
        assert.strictEqual(rescuedSrc.subfolder, undefined);
        console.log('  -> OK: フォルダ削除時にファイルが直下に安全に退避されました');

        // -------------------------------------------------------------
        console.log('Test 6: buildClaudeMdContent での自律探索プロンプト検証');
        const nbDir = await manager.getNotebookDir(nbId);
        const sourcesDir = await manager.getSourcesDir(nbId);
        const artifactsDir = await manager.getArtifactsDir(nbId);

        const claudeMd = buildClaudeMdContent({
            notebookDir: nbDir,
            sourcesDir: sourcesDir,
            artifactsDir: artifactsDir,
            notebookTitle: '基幹システム刷新プロジェクト'
        });

        assert.ok(claudeMd.includes('## インプット (sources/)'), 'インプットセクションが存在すること');
        assert.ok(claudeMd.includes('自律的に探索・確認'), '自律探索のガイダンスが含まれること');
        // 全ファイル一覧（- `sources/...`）が羅列されていないこと
        assert.ok(!claudeMd.includes('- `sources/root_overview.md`'), '不要な全ファイル一覧の羅列が除外されていること');
        console.log('  -> OK: CLAUDE.md が長大ファイル羅列から自律探索ガイダンスへスリム化されました');

        console.log('=== 全 sources/ サブフォルダ管理 & AI自律探索 テストに合格しました (All tests passed) ===');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
