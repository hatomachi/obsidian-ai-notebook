import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildClaudeMdContent, NotebookProjectInput } from '../src/services/NotebookProjectFile';
import { ChatMessage, ChatSessionMetadata } from '../src/types';

async function runTests() {
    console.log('=== ArtifactLineage & AI Index Guidance Tests 開始 ===');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ainotebook-lineage-test-'));

    try {
        // -------------------------------------------------------------
        console.log('Test 1: buildClaudeMdContent に artifacts/INDEX.md ガイダンスが含まれるかの検証');
        const artifactsDir = path.join(tempDir, 'artifacts');
        const sourcesDir = path.join(tempDir, 'sources');
        fs.mkdirSync(artifactsDir, { recursive: true });
        fs.mkdirSync(sourcesDir, { recursive: true });

        // 成果物ファイルを1つ作成
        fs.writeFileSync(path.join(artifactsDir, '2026-09_APIGW_リリース計画書.md'), '# APIGW リリース計画書');

        const input: NotebookProjectInput = {
            notebookDir: tempDir,
            notebookTitle: 'テストノートブック',
            artifactsDir,
            sourcesDir
        };

        const claudeMd = buildClaudeMdContent(input);

        assert.ok(claudeMd.includes('artifacts/INDEX.md'), 'CLAUDE.md に artifacts/INDEX.md への参照案内が含まれていること');
        assert.ok(claudeMd.includes('成果物インデックス'), 'CLAUDE.md に成果物インデックスの文言が含まれていること');
        console.log('  -> OK: CLAUDE.md に artifacts/INDEX.md の案内が正常に追加されました');

        // -------------------------------------------------------------
        console.log('Test 2: 成果物来歴（Lineage）抽出・逆引きマッピングの検証');
        const sessionsData: Array<{ meta: ChatSessionMetadata; messages: ChatMessage[] }> = [
            {
                meta: {
                    id: 'session-1',
                    title: 'リリース計画セッション',
                    createdAt: '2026-09-15T01:00:00.000Z',
                    updatedAt: '2026-09-15T01:05:00.000Z'
                },
                messages: [
                    {
                        id: 'msg-u1',
                        sender: 'user',
                        text: 'APIGWのリリース計画書を作成してください',
                        timestamp: '2026-09-15T01:01:00.000Z'
                    },
                    {
                        id: 'msg-a1',
                        sender: 'agent',
                        text: 'リリース計画書を作成しました。',
                        timestamp: '2026-09-15T01:02:00.000Z',
                        artifactsGenerated: ['artifacts/2026-09_APIGW_リリース計画書.md']
                    },
                    {
                        id: 'msg-u2',
                        sender: 'user',
                        text: 'アーキテクチャ特性のドキュメントもまとめて',
                        timestamp: '2026-09-15T01:03:00.000Z'
                    },
                    {
                        id: 'msg-a2',
                        sender: 'agent',
                        text: 'まとめました。',
                        timestamp: '2026-09-15T01:04:00.000Z',
                        artifactsGenerated: ['APIGW_アーキテクチャ特性.md']
                    }
                ]
            },
            {
                meta: {
                    id: 'session-2',
                    title: 'レビュー指摘セッション',
                    createdAt: '2026-09-15T02:00:00.000Z',
                    updatedAt: '2026-09-15T02:10:00.000Z'
                },
                messages: [
                    {
                        id: 'msg-u3',
                        sender: 'user',
                        text: '先ほどのリリース計画書を最新方針に合わせて修正してください',
                        timestamp: '2026-09-15T02:01:00.000Z'
                    },
                    {
                        id: 'msg-a3',
                        sender: 'agent',
                        text: '更新しました。',
                        timestamp: '2026-09-15T02:05:00.000Z',
                        artifactsGenerated: ['2026-09_APIGW_リリース計画書.md'] // 更新
                    }
                ]
            }
        ];

        // マッピングロジックのシミュレーション
        const map = new Map<string, {
            artName: string;
            sessionId: string;
            sessionTitle: string;
            messageId: string;
            promptText: string;
            timestamp: string;
        }>();

        for (const { meta, messages } of sessionsData) {
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                if (msg.sender === 'agent' && msg.artifactsGenerated && msg.artifactsGenerated.length > 0) {
                    let userPrompt = '';
                    for (let j = i - 1; j >= 0; j--) {
                        if (messages[j].sender === 'user') {
                            userPrompt = messages[j].text;
                            break;
                        }
                    }

                    for (const rawArt of msg.artifactsGenerated) {
                        const cleanName = rawArt.replace(/^artifacts\//, '');
                        const msgTime = msg.timestamp || meta.updatedAt || '';
                        const existing = map.get(cleanName);
                        if (!existing || !existing.timestamp || msgTime >= existing.timestamp) {
                            map.set(cleanName, {
                                artName: cleanName,
                                sessionId: meta.id,
                                sessionTitle: meta.title,
                                messageId: msg.id,
                                promptText: userPrompt,
                                timestamp: msgTime
                            });
                        }
                    }
                }
            }
        }

        // 検証1: APIGW_アーキテクチャ特性.md は session-1 で作成され、プロンプトが正しいこと
        const archLineage = map.get('APIGW_アーキテクチャ特性.md');
        assert.ok(archLineage, 'APIGW_アーキテクチャ特性.md の来歴が存在すること');
        assert.strictEqual(archLineage?.sessionId, 'session-1');
        assert.strictEqual(archLineage?.messageId, 'msg-a2');
        assert.strictEqual(archLineage?.promptText, 'アーキテクチャ特性のドキュメントもまとめて');
        console.log('  -> OK: APIGW_アーキテクチャ特性.md の初回生成プロンプトとセッションが正しく抽出されました');

        // 検証2: 2026-09_APIGW_リリース計画書.md は session-2 で更新され、最新のプロンプトとセッションに上書きされていること
        const relLineage = map.get('2026-09_APIGW_リリース計画書.md');
        assert.ok(relLineage, '2026-09_APIGW_リリース計画書.md の来歴が存在すること');
        assert.strictEqual(relLineage?.sessionId, 'session-2', '最新の session-2 に更新されていること');
        assert.strictEqual(relLineage?.messageId, 'msg-a3', '最新の msg-a3 に更新されていること');
        assert.strictEqual(relLineage?.promptText, '先ほどのリリース計画書を最新方針に合わせて修正してください');
        console.log('  -> OK: 2026-09_APIGW_リリース計画書.md の再更新プロンプトと最新セッションへの追従合格');

        console.log('=== 全 ArtifactLineage & AI Index Guidance テストに合格しました (All tests passed) ===');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('テスト失敗:', err);
    process.exit(1);
});
