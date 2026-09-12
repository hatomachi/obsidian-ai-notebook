import * as assert from 'assert';
import {
    normalizeGitLabBaseUrl,
    encodeProjectId,
    getGitLabHostUrl,
    GitLabService
} from '../src/services/GitLabService';
import { GitLabServerConfig, DEFAULT_SETTINGS, AINotebookSettings } from '../src/types';

console.log('=== GitLabService 単体テスト開始 ===');

// 1. URL 正規化 & ホスト URL 抽出
console.log('Test 1: normalizeGitLabBaseUrl & getGitLabHostUrl');
assert.strictEqual(
    normalizeGitLabBaseUrl('https://gitlab.example.com'),
    'https://gitlab.example.com/api/v4'
);
assert.strictEqual(
    normalizeGitLabBaseUrl('https://gitlab.example.com/'),
    'https://gitlab.example.com/api/v4'
);
assert.strictEqual(
    normalizeGitLabBaseUrl('https://gitlab.example.com/api/v4'),
    'https://gitlab.example.com/api/v4'
);
assert.strictEqual(
    getGitLabHostUrl('https://gitlab.example.com/api/v4'),
    'https://gitlab.example.com'
);
assert.strictEqual(
    getGitLabHostUrl('https://gitlab.example.com'),
    'https://gitlab.example.com'
);
console.log('  -> OK: URL正規化正常');

// 2. Project ID エンコード
console.log('Test 2: encodeProjectId');
assert.strictEqual(encodeProjectId('9876'), '9876');
assert.strictEqual(encodeProjectId('my-org/backend-service'), 'my-org%2Fbackend-service');
console.log('  -> OK: プロジェクトIDエンコード正常');

// 3. マルチサーバー管理
console.log('Test 3: マルチ GitLab サーバー管理');
const server1: GitLabServerConfig = {
    id: 'corp-gitlab',
    name: '全社GitLab',
    baseUrl: 'https://gitlab.company.internal',
    token: 'glpat-token-corp',
    defaultProjectId: 'knowledge/uploads'
};
const server2: GitLabServerConfig = {
    id: 'dept-gitlab',
    name: '部署用GitLab',
    baseUrl: 'https://gitlab.dept.internal',
    token: 'glpat-token-dept',
    defaultProjectId: '1234'
};

const settings: AINotebookSettings = {
    ...DEFAULT_SETTINGS,
    gitlabServers: [server1, server2],
    defaultGitLabServerId: 'corp-gitlab',
    gitlabUploadsEnabled: true
};

const gitlabService = new GitLabService(settings);
assert.strictEqual(gitlabService.getServers().length, 2, '2つのサーバーが取得できること');
assert.strictEqual(gitlabService.getServer()?.id, 'corp-gitlab', 'デフォルトサーバーが返ること');
assert.strictEqual(gitlabService.getServer('dept-gitlab')?.id, 'dept-gitlab', '指定したサーバーが返ること');
assert.strictEqual(gitlabService.isConfigured('corp-gitlab'), true, '設定完了判定が正しいこと');
assert.strictEqual(gitlabService.isUploadsEnabled('corp-gitlab'), true, 'アップロード有効判定が正しいこと');
console.log('  -> OK: マルチサーバー管理正常');

// 4. バリデーション
console.log('Test 4: プロジェクトID未設定時のアップロードバリデーション');
(async () => {
    const unconfiguredService = new GitLabService({
        ...DEFAULT_SETTINGS,
        gitlabServers: [],
        defaultGitLabServerId: '',
        gitlabUploadsEnabled: true
    });
    const resUnconf = await unconfiguredService.uploadFile(Buffer.from('test'), 'test.txt');
    assert.strictEqual(resUnconf.success, false, '未設定時は失敗すること');
    assert.ok(resUnconf.error?.includes('設定されていない'), '適切なエラーが返ること');
    console.log('  -> OK: バリデーション正常');
    console.log('=== GitLabService 単体テスト全件合格 ===');
})().catch(e => {
    console.error('Test error:', e);
    process.exit(1);
});
