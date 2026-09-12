import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitLabService } from '../src/services/GitLabService';
import { NotebookManager } from '../src/services/NotebookManager';
import { AINotebookSettings, DEFAULT_SETTINGS, GitLabServerConfig, GitLabTreeItem } from '../src/types';
import { App, FileSystemAdapter, TFile, TFolder, parseYaml, stringifyYaml, __setRequestUrlMock } from 'obsidian';

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
        delete: async (file: any, force?: boolean) => {
            const abs = path.join(tmpDir, normalize(file.path));
            if (fs.existsSync(abs)) {
                const stat = fs.statSync(abs);
                if (stat.isDirectory()) {
                    fs.rmSync(abs, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(abs);
                }
            }
        }
    };
}

async function runTests() {
    console.log('=== GitLab API オンデマンド参照＆同期 (Step 4) 単体テスト開始 ===');

    const testServer: GitLabServerConfig = {
        id: 'srv_test',
        name: '共有GitLab',
        baseUrl: 'https://gitlab.example.com',
        token: 'glpat-test-token',
        defaultProjectId: 'team/ainotebook',
        defaultBranch: 'main'
    };

    const settings: AINotebookSettings = {
        ...DEFAULT_SETTINGS,
        rootDir: '_ainotebook',
        userName: 'alice',
        gitlabServers: [testServer],
        defaultGitLabServerId: 'srv_test'
    };

    // ----------------------------------------------------
    // Test 1: GitLabService API 単体メソッド検証
    // ----------------------------------------------------
    console.log('Test 1: GitLabService API 単体メソッド検証');
    const service = new GitLabService(settings);

    let recordedRequests: any[] = [];
    __setRequestUrlMock(async (req: any) => {
        recordedRequests.push(req);
        const url = req.url || '';

        // 1. tree リクエスト
        if (url.includes('/repository/tree')) {
            const items: GitLabTreeItem[] = [
                { id: '1', name: 'nb_bob_01.md', type: 'blob', path: '_ainotebook/users/bob/index/nb_bob_01.md', mode: '100644' },
                { id: '2', name: 'NOTEBOOK.md', type: 'blob', path: '_ainotebook/users/bob/notebooks/nb_bob_01/NOTEBOOK.md', mode: '100644' },
                { id: '3', name: 'spec.md', type: 'blob', path: '_ainotebook/users/bob/notebooks/nb_bob_01/sources/spec.md', mode: '100644' },
                { id: '4', name: 'design.md', type: 'blob', path: '_ainotebook/users/bob/notebooks/nb_bob_01/artifacts/design.md', mode: '100644' },
                { id: '5', name: 'sess_bob_01.json', type: 'blob', path: '_ainotebook/users/bob/notebooks/nb_bob_01/sessions/sess_bob_01.json', mode: '100644' }
            ];
            return { status: 200, headers: {}, json: items, text: JSON.stringify(items), arrayBuffer: Buffer.from(JSON.stringify(items)) };
        }

        // 2. raw リクエスト
        if (url.includes('/raw')) {
            if (url.includes('nb_bob_01.md')) {
                const content = `---\nnotebook_id: nb_bob_01\ntitle: "Bobの設計ノート"\nuser_name: bob\ncreated_at: "2026-09-12T10:00:00Z"\nupdated_at: "2026-09-12T10:00:00Z"\n---\n# Bobの設計ノート\nBobのノート詳細`;
                return { status: 200, headers: {}, text: content, json: null, arrayBuffer: Buffer.from(content) };
            }
            if (url.includes('NOTEBOOK.md')) {
                const content = `# Bobの設計ノート\n方針と計画`;
                return { status: 200, headers: {}, text: content, json: null, arrayBuffer: Buffer.from(content) };
            }
            if (url.includes('spec.md')) {
                const content = `# 仕様書\n要件一覧`;
                return { status: 200, headers: {}, text: content, json: null, arrayBuffer: Buffer.from(content) };
            }
            if (url.includes('design.md')) {
                const content = `# 設計成果物\nアーキテクチャ図`;
                return { status: 200, headers: {}, text: content, json: null, arrayBuffer: Buffer.from(content) };
            }
            if (url.includes('sess_bob_01.json')) {
                const content = JSON.stringify({
                    id: 'sess_bob_01',
                    title: 'Bobの相談セッション',
                    createdAt: '2026-09-12T10:00:00Z',
                    updatedAt: '2026-09-12T10:00:00Z',
                    messages: [{ id: 'm1', sender: 'user', text: 'こんにちは', timestamp: '2026-09-12T10:00:00Z' }]
                });
                return { status: 200, headers: {}, text: content, json: null, arrayBuffer: Buffer.from(content) };
            }
            return { status: 200, headers: {}, text: 'mock text', json: null, arrayBuffer: Buffer.from('mock text') };
        }

        // 3. checkFileExists (HEAD)
        if (req.method === 'HEAD') {
            if (!url.includes('non_existing') && url.includes('existing')) {
                return { status: 200, headers: {} };
            }
            return { status: 404, headers: {} };
        }

        // 4. commits
        if (url.includes('/commits') && req.method === 'POST') {
            const body = JSON.parse(req.body);
            return { status: 201, headers: {}, json: { id: 'commit_sha_12345', short_id: 'commit_123' }, text: '{"id":"commit_sha_12345"}' };
        }

        return { status: 200, headers: {}, json: {}, text: '{}' };
    });

    // 1-1. listRepositoryTree
    const tree = await service.listRepositoryTree({ serverId: 'srv_test' });
    assert.strictEqual(tree.length, 5);
    assert.strictEqual(tree[0].name, 'nb_bob_01.md');
    console.log('  -> OK: listRepositoryTree 正常取得');

    // 1-2. getFileRaw
    const rawText = await service.getFileRaw('_ainotebook/users/bob/index/nb_bob_01.md', { serverId: 'srv_test' });
    assert.ok(rawText.includes('Bobの設計ノート'));
    console.log('  -> OK: getFileRaw 正常取得');

    // 1-3. checkFileExists
    const exists = await service.checkFileExists('_ainotebook/existing.md', { serverId: 'srv_test' });
    assert.strictEqual(exists, true);
    const notExists = await service.checkFileExists('_ainotebook/non_existing.md', { serverId: 'srv_test' });
    assert.strictEqual(notExists, false);
    console.log('  -> OK: checkFileExists 判定正常');

    // 1-4. commitFiles
    const commitRes = await service.commitFiles({
        actions: [{ action: 'create', file_path: 'test.md', content: 'hello' }],
        commitMessage: 'test commit',
        serverId: 'srv_test'
    });
    assert.strictEqual(commitRes.success, true);
    assert.strictEqual(commitRes.commitId, 'commit_sha_12345');
    console.log('  -> OK: commitFiles 正常完了');

    // ----------------------------------------------------
    // Test 2: NotebookManager リモート走査＆マージ
    // ----------------------------------------------------
    console.log('\nTest 2: NotebookManager リモート走査＆マージ (getAllNotebooks)');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-test-ondemand-'));
    try {
        const mockVault = createMockVault(tmpDir);
        const mockApp: any = { vault: mockVault };
        const manager = new NotebookManager(mockApp, settings, service);

        // ローカルに Alice のノートブックを作成
        const aliceMeta = await manager.createNotebook('Aliceのローカルノート');
        assert.strictEqual(aliceMeta.userName, 'alice');

        const all = await manager.getAllNotebooks();
        assert.ok(all.length >= 2, 'ローカルノートとGitLabリモートノートが含まれること');

        const bobNotebook = all.find(n => n.id === 'nb_bob_01');
        assert.ok(bobNotebook, 'Bobのノートブックがマージされていること');
        assert.strictEqual(bobNotebook!.isRemote, true);
        assert.strictEqual(bobNotebook!.userName, 'bob');
        assert.strictEqual(bobNotebook!.remoteServerId, 'srv_test');

        const aliceNotebook = all.find(n => n.id === aliceMeta.id);
        assert.ok(aliceNotebook);
        assert.strictEqual(aliceNotebook!.isRemote, undefined);
        console.log('  -> OK: ローカルとGitLabリモートノートブックのマージ正常');

        // ----------------------------------------------------
        // Test 3: オンデマンド取得 (getSources, getArtifacts, getChatSessions)
        // ----------------------------------------------------
        console.log('\nTest 3: オンデマンド取得 (getSources, getArtifacts, getChatSessions, getChatSession)');
        const bobSources = await manager.getSources('nb_bob_01');
        assert.strictEqual(bobSources.length, 1);
        assert.strictEqual(bobSources[0].name, 'spec.md');

        const bobArtifacts = await manager.getArtifacts('nb_bob_01');
        assert.strictEqual(bobArtifacts.length, 1);
        assert.strictEqual(bobArtifacts[0].title, 'design');

        const bobSessions = await manager.getChatSessions('nb_bob_01');
        assert.strictEqual(bobSessions.length, 1);
        assert.strictEqual(bobSessions[0].title, 'Bobの相談セッション');

        const bobSession = await manager.getChatSession('nb_bob_01', 'sess_bob_01');
        assert.ok(bobSession);
        assert.strictEqual(bobSession!.messages.length, 1);
        assert.strictEqual(bobSession!.messages[0].text, 'こんにちは');
        console.log('  -> OK: リモート資産のオンデマンド取得正常');

        // ----------------------------------------------------
        // Test 4: クラウドからのフォーク (forkRemoteNotebook)
        // ----------------------------------------------------
        console.log('\nTest 4: クラウドからのフォーク (forkRemoteNotebook)');
        const forked = await manager.forkNotebook('nb_bob_01');
        assert.ok(forked);
        assert.notStrictEqual(forked.id, 'nb_bob_01');
        assert.strictEqual(forked.userName, 'alice', 'フォーク後はカレントユーザーの縄張りになること');
        assert.strictEqual(forked.isRemote, false, '実体化されたため isRemote が false であること');
        assert.ok(forked.title.includes('Bobの設計ノート'));

        // ローカルに実体ファイルが書き込まれているか確認
        const forkedIndexPath = await manager.getNotebookIndexPath(forked.id);
        assert.ok(mockVault.getAbstractFileByPath(forkedIndexPath), 'インデックスファイルが実体化');
        const forkedSourcesDir = await manager.getSourcesDir(forked.id);
        const forkedSpec = mockVault.getAbstractFileByPath(`${forkedSourcesDir}/spec.md`);
        assert.ok(forkedSpec, 'ソースファイル spec.md がローカルに実体化');
        const forkedArtifactsDir = await manager.getArtifactsDir(forked.id);
        const forkedDesign = mockVault.getAbstractFileByPath(`${forkedArtifactsDir}/design.md`);
        assert.ok(forkedDesign, '成果物ファイル design.md がローカルに実体化');
        console.log('  -> OK: クラウドからのフォーク（実体化保存）正常完了');

        // ----------------------------------------------------
        // Test 5: GitLab リポジトリへの保存 (pushNotebookToGitLab)
        // ----------------------------------------------------
        console.log('\nTest 5: GitLab リポジトリへの保存 (pushNotebookToGitLab)');
        // Alice のノートブックを GitLab へコミット保存
        recordedRequests = [];
        const pushRes = await manager.pushNotebookToGitLab(aliceMeta.id, 'feat: first sync');
        assert.strictEqual(pushRes.success, true);
        assert.strictEqual(pushRes.commitId, 'commit_sha_12345');

        // コミットリクエストの内容を確認
        const commitReq = recordedRequests.find(r => r.url && r.url.includes('/commits'));
        assert.ok(commitReq, 'GitLab Commits API が呼ばれていること');
        const payload = JSON.parse(commitReq.body);
        assert.strictEqual(payload.branch, 'main');
        assert.strictEqual(payload.commit_message, 'feat: first sync');
        assert.ok(payload.actions.length >= 1, 'インデックス等のアクションが含まれていること');

        // メタデータの syncedAt が更新されているか確認
        const updatedAlice = await manager.getNotebookMetadata(aliceMeta.id);
        assert.ok(updatedAlice?.syncedAt, 'syncedAt が記録されていること');
        console.log('  -> OK: GitLab への一括コミット保存（Push）正常完了');

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        __setRequestUrlMock(null);
    }

    console.log('\n=== 全 GitLabOnDemand 単体テストに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
