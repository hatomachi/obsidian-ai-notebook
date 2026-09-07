import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildClaudeArgs } from '../src/adapters/ClaudeCodeAdapter';
import { StreamJsonAccumulator } from '../src/adapters/StreamJsonParser';
import { buildClaudeMdContent, collectAdditionalReadDirs, ensureNotebookProject } from '../src/services/NotebookProjectFile';
import { LinkedContext } from '../src/types';

/** 実機の `claude --help` から採取した、対応フラグの集合 */
const MODERN_FLAGS = new Set([
    '--permission-mode', '--output-format', '--verbose', '--add-dir',
    '--resume', '--session-id', '--append-system-prompt', '--model'
]);
const modern = (f: string) => MODERN_FLAGS.has(f);
const ancient = (_f: string) => false;

const mockLinkedContexts: LinkedContext[] = [
    {
        notebookId: 'nb_sys_apigw',
        notebookTitle: 'APIGW システム仕様・クセ',
        description: 'APIGW のアーキテクチャおよび運用上の注意事項',
        artifacts: [
            {
                name: 'アーキテクチャ概要.md', title: 'アーキテクチャ概要',
                path: '_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
                absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_sys_apigw/artifacts/アーキテクチャ概要.md',
                size: 15420
            },
            {
                name: '過去トラブル事例集.md', title: '過去トラブル事例集',
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
        artifacts: [{
            name: 'リリース計画書_作成ルール.md', title: 'リリース計画書 作成ルール',
            path: '_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md',
            absolutePath: '/Users/test/vault/_ainotebook/notebooks/nb_tpl_release/artifacts/リリース計画書_作成ルール.md',
            size: 12300
        }]
    }
];

const NB_DIR = '/Users/test/vault/_ainotebook/notebooks/20260902_task';

function pairAfter(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
}

async function runTests() {
    console.log('=== エージェント実行 単体テスト開始 ===');

    // ---------------------------------------------------------------
    console.log('Test 1: 実行モードが --permission-mode にマップされること');
    const consult = buildClaudeArgs({ mode: 'consult', supports: modern, additionalReadDirs: [] });
    assert.strictEqual(pairAfter(consult.args, '--permission-mode'), 'plan', '相談モードは plan');

    const build = buildClaudeArgs({ mode: 'build', supports: modern, additionalReadDirs: [] });
    assert.strictEqual(pairAfter(build.args, '--permission-mode'), 'bypassPermissions', '作成モードは bypassPermissions');

    // 振る舞いの指示をプロンプトで注入しないので、システムプロンプト系フラグは使わない
    assert.ok(!build.args.includes('--append-system-prompt'), 'システムプロンプトを注入しないこと');
    // この版の CLI には存在しないフラグを渡さないこと
    assert.ok(!build.args.includes('--max-turns'), '--max-turns を渡さないこと');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 2: stream-json は --verbose とセットで付くこと / -p は最後');
    assert.strictEqual(build.streamJson, true, 'stream-json が有効になること');
    assert.strictEqual(pairAfter(build.args, '--output-format'), 'stream-json');
    assert.ok(build.args.includes('--verbose'), '--verbose が付くこと');
    assert.strictEqual(build.args[build.args.length - 1], '-p', '-p が末尾（値なし=stdin読み込み）であること');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 3: 未対応フラグは渡さず、旧版へ安全に縮退すること');
    const legacy = buildClaudeArgs({
        mode: 'build', supports: ancient,
        additionalReadDirs: ['/tmp/a'], agentSessionId: 'abc', resumeSession: true
    });
    assert.ok(!legacy.args.includes('--permission-mode'), '未対応なら --permission-mode を渡さない');
    assert.ok(legacy.args.includes('--dangerously-skip-permissions'), '旧フラグへフォールバックすること');
    assert.strictEqual(legacy.streamJson, false, 'stream-json を無効化すること');
    assert.ok(!legacy.args.includes('--add-dir'), '未対応なら --add-dir を渡さない');
    assert.ok(!legacy.args.includes('--resume'), '未対応なら --resume を渡さない');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 4: セッション継続 (--session-id / --resume) と --add-dir');
    const fresh = buildClaudeArgs({
        mode: 'build', supports: modern,
        additionalReadDirs: ['/vault/nb_a/artifacts', '/vault/nb_b/artifacts'],
        agentSessionId: 'uuid-1', resumeSession: false
    });
    assert.strictEqual(pairAfter(fresh.args, '--session-id'), 'uuid-1', '初回は --session-id で採番IDを渡すこと');
    assert.ok(!fresh.args.includes('--resume'), '初回は --resume を使わないこと');
    assert.strictEqual(fresh.args.filter(a => a === '--add-dir').length, 2, '参照先の数だけ --add-dir が付くこと');

    const resumed = buildClaudeArgs({
        mode: 'build', supports: modern, additionalReadDirs: [],
        agentSessionId: 'uuid-1', resumeSession: true
    });
    assert.strictEqual(pairAfter(resumed.args, '--resume'), 'uuid-1', '2回目以降は --resume で継続すること');
    assert.ok(!resumed.args.includes('--session-id'), '継続時は --session-id を使わないこと');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 5: stream-json のパース（進捗・ツール痕跡・セッションID）');
    const progress: string[] = [];
    const acc = new StreamJsonAccumulator(line => progress.push(line));

    const events = [
        { type: 'system', subtype: 'init', session_id: 'sess-42' },
        { type: 'assistant', message: { content: [
            { type: 'text', text: '見積を作成します' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'sources/memo.md' } }
        ] } },
        { type: 'assistant', message: { content: [
            { type: 'tool_use', name: 'Write', input: { file_path: 'artifacts/見積.md' } }
        ] } },
        { type: 'result', subtype: 'success', session_id: 'sess-42', result: '積み上げ表を作成しました', num_turns: 4, total_cost_usd: 0.12 }
    ];
    const ndjson = events.map(e => JSON.stringify(e)).join('\n') + '\n';

    // チャンク境界が行の途中で切れても壊れないこと
    for (let i = 0; i < ndjson.length; i += 7) acc.push(ndjson.slice(i, i + 7));
    const summary = acc.finish();

    assert.strictEqual(summary.sessionId, 'sess-42', 'セッションIDを取得できること');
    assert.strictEqual(summary.resultText, '積み上げ表を作成しました', 'result を最終応答にすること');
    assert.deepStrictEqual(summary.toolUses, ['Read sources/memo.md', 'Write artifacts/見積.md'], 'ツール痕跡を記録すること');
    assert.strictEqual(summary.isError, false);
    assert.strictEqual(summary.numTurns, 4);
    assert.ok(progress.some(l => l.includes('Write artifacts/見積.md')), '進捗コールバックが呼ばれること');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 6: ツール拒否・非JSON行の扱い');
    const acc2 = new StreamJsonAccumulator();
    acc2.push(JSON.stringify({ type: 'user', message: { content: [
        { type: 'tool_result', is_error: true, content: 'Permission to write was denied' }
    ] } }) + '\n');
    acc2.push(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' }) + '\n');
    const s2 = acc2.finish();
    assert.strictEqual(s2.toolErrors.length, 1, 'ツール拒否を捕捉できること');
    assert.ok(s2.toolErrors[0].includes('denied'));
    assert.strictEqual(s2.isError, true, 'result の失敗を検知できること');

    // stream-json 非対応版が素のテキストを吐いた場合も落ちないこと
    const acc3 = new StreamJsonAccumulator();
    acc3.push('ただのテキスト出力です\n');
    assert.strictEqual(acc3.finish().resultText, 'ただのテキスト出力です', '非JSONはそのまま応答にすること');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 7: CLAUDE.md に参照コンテキストの絶対パスが載ること');
    const claudeMd = buildClaudeMdContent({
        notebookDir: NB_DIR,
        sourcesDir: path.join(NB_DIR, 'sources'),
        artifactsDir: path.join(NB_DIR, 'artifacts'),
        notebookTitle: '2026-09 APIGW リリース計画書作成',
        linkedContexts: mockLinkedContexts,
        boundFolderTreeText: '共有フォルダ/\n  2024/\n    A社_基幹刷新/'
    });
    for (const abs of mockLinkedContexts.flatMap(c => c.artifacts.map(a => a.absolutePath!))) {
        assert.ok(claudeMd.includes(abs), `成果物の絶対パスが含まれること: ${abs}`);
    }
    assert.ok(claudeMd.includes('@NOTEBOOK.md'), '人間用レイヤの import が含まれること');
    assert.ok(claudeMd.includes('A社_基幹刷新'), 'バインドフォルダのツリーが含まれること');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 8: --add-dir 対象ディレクトリの収集');
    const dirs = collectAdditionalReadDirs({
        notebookDir: NB_DIR,
        sourcesDir: path.join(NB_DIR, 'sources'),
        artifactsDir: path.join(NB_DIR, 'artifacts'),
        linkedContexts: mockLinkedContexts
    });
    assert.strictEqual(dirs.length, 2, '重複が排除されること');

    const selfDirs = collectAdditionalReadDirs({
        notebookDir: NB_DIR,
        sourcesDir: path.join(NB_DIR, 'sources'),
        artifactsDir: path.join(NB_DIR, 'artifacts'),
        linkedContexts: [{
            notebookId: 'self', notebookTitle: 'self', description: '',
            artifacts: [{ name: 'a.md', title: 'a', path: 'x', absolutePath: path.join(NB_DIR, 'artifacts', 'a.md') }]
        }]
    });
    assert.strictEqual(selfDirs.length, 0, 'cwd 配下は --add-dir 対象にしないこと');
    console.log('  -> OK');

    // ---------------------------------------------------------------
    console.log('Test 9: ノートブックフォルダのプロジェクト化（実ファイル生成）');
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ainb-'));
    const nbDir = path.join(tmpRoot, 'notebooks', '20260907_test');
    const srcDir = path.join(nbDir, 'sources');
    const artDir = path.join(nbDir, 'artifacts');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(artDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'meeting_memo.md'), '# 議事録\n', 'utf-8');

    const input = {
        notebookDir: nbDir, sourcesDir: srcDir, artifactsDir: artDir,
        notebookTitle: 'テストノートブック', linkedContexts: mockLinkedContexts
    };
    const result = ensureNotebookProject(input);

    for (const f of ['CLAUDE.md', 'AGENTS.md', 'NOTEBOOK.md', path.join('.claude', 'settings.json')]) {
        assert.ok(fs.existsSync(path.join(nbDir, f)), `${f} が生成されること`);
    }
    assert.ok(fs.readFileSync(path.join(nbDir, 'CLAUDE.md'), 'utf-8').includes('meeting_memo.md'), 'sources のインベントリが反映されること');

    const settings = JSON.parse(fs.readFileSync(path.join(nbDir, '.claude', 'settings.json'), 'utf-8'));
    assert.deepStrictEqual(settings.permissions.additionalDirectories, result.additionalReadDirs, '参照先が読み取り許可に載ること');

    // NOTEBOOK.md は人間の資産。再生成で上書きされないこと。
    fs.writeFileSync(path.join(nbDir, 'NOTEBOOK.md'), '# 手書きの指示\n用語はAPIGWで統一\n', 'utf-8');
    ensureNotebookProject(input);
    assert.ok(
        fs.readFileSync(path.join(nbDir, 'NOTEBOOK.md'), 'utf-8').includes('用語はAPIGWで統一'),
        'NOTEBOOK.md が再生成で上書きされないこと'
    );

    // .claude/settings.json の既存キーはマージ保持されること
    const settingsPath = path.join(nbDir, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ model: 'opus', permissions: { allow: ['Read'] } }, null, 2), 'utf-8');
    ensureNotebookProject(input);
    const merged = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.strictEqual(merged.model, 'opus', '既存の設定キーが保持されること');
    assert.deepStrictEqual(merged.permissions.allow, ['Read'], '既存の permissions キーが保持されること');

    fs.rmSync(tmpRoot, { recursive: true, force: true });
    console.log('  -> OK');

    console.log('=== 全テストケースに合格しました (All tests passed) ===');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
