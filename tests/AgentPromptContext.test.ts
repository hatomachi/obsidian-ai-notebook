import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentOptions, buildAgentSystemPrompt, buildUserTurn, buildDirectEditSystemPrompt } from '../src/adapters/AgentAdapter';
import { RETRY_DIRECTIVE } from '../src/adapters/AgentCharter';
import { buildClaudeMdContent, collectAdditionalReadDirs, ensureNotebookProject } from '../src/services/NotebookProjectFile';
import { LinkedContext } from '../src/types';

const mockLinkedContexts: LinkedContext[] = [
    {
        notebookId: 'nb_sys_apigw',
        notebookTitle: 'APIGW システム仕様・クセ',
        description: 'APIGW のアーキテクチャおよび運用上の注意事項',
        artifacts: [
            {
                name: 'アーキテクチャ概要.md',
                title: 'アーキテクチャ概要',
                path: '_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
                absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
                size: 15420
            },
            {
                name: '過去トラブル事例集.md',
                title: '過去トラブル事例集',
                path: '_ainotebook/notebooks/nb_sys_apigw/artifacts/過去トラブル事例集.md',
                absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/過去トラブル事例集.md',
                size: 28900
            }
        ]
    },
    {
        notebookId: 'nb_tpl_release',
        notebookTitle: 'リリース計画書 デザイン仕様',
        description: 'リリース計画書の作成基準とfew-shotサンプル',
        artifacts: [
            {
                name: 'リリース計画書_作成ルール.md',
                title: 'リリース計画書 作成ルール',
                path: '_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md',
                absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md',
                size: 12300
            }
        ]
    }
];

const baseOptions: AgentOptions = {
    notebookDir: '/Users/test/vault/_ainotebook/notebooks/20260902_task',
    sourcesDir: '/Users/test/vault/_ainotebook/notebooks/20260902_task/sources',
    artifactsDir: '/Users/test/vault/_ainotebook/notebooks/20260902_task/artifacts',
    commandPath: 'claude',
    notebookTitle: '2026-09 APIGW リリース計画書作成',
    notebookDescription: '2026年9月度 APIGW 本番リリース計画書の作成',
    linkedContexts: mockLinkedContexts
};

const userPrompt = 'APIGWのRTC時刻適正化のため、停止起動をする。テストフレームの仕様は参照コンテキストで調べて';

async function runTests() {
    console.log('=== AgentPromptContext 単体テスト開始 ===');

    // ---------------------------------------------------------------
    console.log('Test 1: システムプロンプト(L0憲章+L1パス)の内容と分離');
    const systemPrompt = buildAgentSystemPrompt(baseOptions);

    assert.ok(systemPrompt.includes('これは1回限りの非対話実行です'), '非対話実行契約が含まれること');
    assert.ok(systemPrompt.includes('質問・確認・提案だけを返して終了することは、タスクの失敗とみなされます'), '質問のみ返却の禁止が明記されること');
    assert.ok(systemPrompt.includes('質問は成果物の代わりではなく、成果物に添えるもの'), 'ドラフト優先の順序が明記されること');
    assert.ok(systemPrompt.includes('## 確認したいこと'), '応答フォーマットが規定されること');
    assert.ok(systemPrompt.includes(baseOptions.notebookDir), 'cwd の絶対パスが含まれること');
    assert.ok(systemPrompt.includes('CLAUDE.md'), 'CLAUDE.md への導線が含まれること');

    // ユーザー指示はシステムプロンプト側に混ざらないこと（層の分離）
    assert.ok(!systemPrompt.includes(userPrompt), 'ユーザー指示がシステムプロンプトに混入しないこと');
    // 参照コンテキストの列挙は CLAUDE.md 側に移譲され、argv を肥大させないこと
    assert.ok(!systemPrompt.includes('過去トラブル事例集.md'), '成果物一覧がシステムプロンプトに混入しないこと');

    console.log(`  -> システムプロンプト長: ${systemPrompt.length} 文字 (${Buffer.byteLength(systemPrompt, 'utf-8')} bytes)`);
    assert.ok(systemPrompt.length < 3000, `システムプロンプトが 3000 文字未満であること (実際: ${systemPrompt.length})`);
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 2: ユーザーターン(L4)は指示と履歴のみ');
    const userTurn = buildUserTurn(userPrompt, baseOptions);
    assert.ok(userTurn.includes(userPrompt), 'ユーザー指示が含まれること');
    assert.ok(!userTurn.includes('これは1回限りの非対話実行です'), '憲章がユーザーターンに混入しないこと');
    assert.ok(!userTurn.startsWith('【自動再実行'), '通常時は再実行ディレクティブが付かないこと');

    const retryTurn = buildUserTurn(userPrompt, { ...baseOptions, retryDirective: RETRY_DIRECTIVE });
    assert.ok(retryTurn.startsWith('【自動再実行：前回の実行は失敗しました】'), '再実行時はディレクティブが先頭に付くこと');
    assert.ok(retryTurn.includes(userPrompt), '再実行時も元の指示が保持されること');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 3: CLAUDE.md に参照コンテキストの絶対パスが載ること');
    const claudeMd = buildClaudeMdContent({
        notebookDir: baseOptions.notebookDir,
        sourcesDir: baseOptions.sourcesDir,
        artifactsDir: baseOptions.artifactsDir,
        notebookTitle: baseOptions.notebookTitle,
        notebookDescription: baseOptions.notebookDescription,
        linkedContexts: mockLinkedContexts,
        boundFolderTreeText: '共有フォルダ/\n  2024/\n    A社_基幹刷新/'
    });

    for (const abs of [
        '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
        '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/過去トラブル事例集.md',
        '/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md'
    ]) {
        assert.ok(claudeMd.includes(abs), `成果物の絶対パスが含まれること: ${abs}`);
    }
    assert.ok(claudeMd.includes('# ノートブック: 2026-09 APIGW リリース計画書作成'), 'タイトル見出しが含まれること');
    assert.ok(claudeMd.includes('@NOTEBOOK.md'), '人間用レイヤの import が含まれること');
    assert.ok(claudeMd.includes('A社_基幹刷新'), 'バインドフォルダのツリーが含まれること');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 4: --add-dir 対象ディレクトリの収集');
    const dirs = collectAdditionalReadDirs({
        notebookDir: baseOptions.notebookDir,
        sourcesDir: baseOptions.sourcesDir,
        artifactsDir: baseOptions.artifactsDir,
        linkedContexts: mockLinkedContexts
    });
    assert.ok(dirs.includes('/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts'), '参照NBのartifactsが対象になること');
    assert.ok(dirs.includes('/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts'), '参照NBのartifactsが対象になること');
    assert.strictEqual(dirs.length, 2, '重複が排除されること');

    // 自ノートブック配下は cwd に含まれるため対象外
    const selfDirs = collectAdditionalReadDirs({
        notebookDir: baseOptions.notebookDir,
        sourcesDir: baseOptions.sourcesDir,
        artifactsDir: baseOptions.artifactsDir,
        linkedContexts: [{
            notebookId: 'self',
            notebookTitle: 'self',
            description: '',
            artifacts: [{
                name: 'a.md', title: 'a',
                path: 'x',
                absolutePath: path.join(baseOptions.artifactsDir, 'a.md')
            }]
        }]
    });
    assert.strictEqual(selfDirs.length, 0, 'cwd 配下は --add-dir 対象にしないこと');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 5: ノートブックフォルダのプロジェクト化（実ファイル生成）');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-'));
    const nbDir = path.join(tmpRoot, 'notebooks', '20260907_test');
    const srcDir = path.join(nbDir, 'sources');
    const artDir = path.join(nbDir, 'artifacts');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'meeting_memo.md'), '# 議事録\n', 'utf-8');

    const result = ensureNotebookProject({
        notebookDir: nbDir,
        sourcesDir: srcDir,
        artifactsDir: artDir,
        notebookTitle: 'テストノートブック',
        linkedContexts: mockLinkedContexts
    });

    assert.ok(fs.existsSync(path.join(nbDir, 'CLAUDE.md')), 'CLAUDE.md が生成されること');
    assert.ok(fs.existsSync(path.join(nbDir, 'AGENTS.md')), 'AGENTS.md が生成されること');
    assert.ok(fs.existsSync(path.join(nbDir, 'NOTEBOOK.md')), 'NOTEBOOK.md が生成されること');
    assert.ok(fs.existsSync(path.join(nbDir, '.claude', 'settings.json')), '.claude/settings.json が生成されること');

    const generated = fs.readFileSync(path.join(nbDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(generated.includes('meeting_memo.md'), 'sources のインベントリが反映されること');

    const settings = JSON.parse(fs.readFileSync(path.join(nbDir, '.claude', 'settings.json'), 'utf-8'));
    assert.deepStrictEqual(settings.permissions.additionalDirectories, result.additionalReadDirs, '参照先が読み取り許可に載ること');

    // NOTEBOOK.md は人間の資産。再実行で上書きされないこと。
    fs.writeFileSync(path.join(nbDir, 'NOTEBOOK.md'), '# 手書きの指示\n用語はAPIGWで統一\n', 'utf-8');
    ensureNotebookProject({
        notebookDir: nbDir,
        sourcesDir: srcDir,
        artifactsDir: artDir,
        notebookTitle: 'テストノートブック',
        linkedContexts: mockLinkedContexts
    });
    assert.ok(
        fs.readFileSync(path.join(nbDir, 'NOTEBOOK.md'), 'utf-8').includes('用語はAPIGWで統一'),
        'NOTEBOOK.md が再生成で上書きされないこと'
    );

    // .claude/settings.json の既存キーがマージ保持されること
    const settingsPath = path.join(nbDir, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] } }, null, 2), 'utf-8');
    ensureNotebookProject({
        notebookDir: nbDir, sourcesDir: srcDir, artifactsDir: artDir,
        notebookTitle: 'テストノートブック', linkedContexts: mockLinkedContexts
    });
    const merged = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.strictEqual(merged.model, 'opus', '既存の設定キーが保持されること');
    assert.deepStrictEqual(merged.permissions.allow, ['Read'], '既存の permissions キーが保持されること');
    assert.ok(Array.isArray(merged.permissions.additionalDirectories), 'additionalDirectories が更新されること');

    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 6: 結合版(後方互換)は憲章・文脈・指示をすべて含むこと');
    const combined = buildDirectEditSystemPrompt(userPrompt, baseOptions);
    assert.ok(combined.includes('これは1回限りの非対話実行です'), '憲章が含まれること');
    assert.ok(combined.includes('/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md'), '参照コンテキストが含まれること');
    assert.ok(combined.includes(userPrompt), 'ユーザー指示が含まれること');
    console.log(`  -> 結合プロンプト長: ${combined.length} 文字`);
    assert.ok(combined.length < 8000, `結合版でも 8000 文字未満であること (実際: ${combined.length})`);
    console.log('  -> OK');

    console.log('=== 全テストケースに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
