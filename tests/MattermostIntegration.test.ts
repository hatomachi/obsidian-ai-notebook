import { MattermostFormatter } from '../src/services/MattermostFormatter';
import { MattermostChannelRef, MattermostPostList, MattermostUser } from '../src/types';

function runMattermostTests() {
    console.log('=== MattermostIntegration 単体テスト開始 ===');

    const mockChannel: MattermostChannelRef = {
        teamId: 'team_apigw',
        teamName: 'api-platform',
        channelId: 'chan_123',
        channelName: 'apigw-dev',
        displayName: 'APIGW 開発'
    };

    const mockUserMap = new Map<string, MattermostUser>([
        ['user_1', { id: 'user_1', username: 'tanaka', first_name: '太郎', last_name: '田中' }],
        ['user_2', { id: 'user_2', username: 'suzuki', nickname: 'すずき' }]
    ]);

    const mockPostList: MattermostPostList = {
        order: ['post_3', 'post_2', 'post_1'], // 降順
        posts: {
            'post_1': {
                id: 'post_1',
                create_at: 1725612000000,
                update_at: 1725612000000,
                delete_at: 0,
                edit_at: 0,
                user_id: 'user_1',
                channel_id: 'chan_123',
                root_id: '',
                original_id: '',
                message: '来週のリリースですが、セッションタイムアウトを延長したいです。',
                type: ''
            },
            'post_2': {
                id: 'post_2',
                create_at: 1725612300000,
                update_at: 1725612300000,
                delete_at: 0,
                edit_at: 0,
                user_id: 'user_2',
                channel_id: 'chan_123',
                root_id: 'post_1',
                original_id: '',
                message: 'Pod数を増やせば耐えられます。',
                type: ''
            },
            'post_3': {
                id: 'post_3',
                create_at: 1725612600000,
                update_at: 1725612600000,
                delete_at: 0,
                edit_at: 0,
                user_id: 'user_1',
                channel_id: 'chan_123',
                root_id: 'post_1',
                original_id: '',
                message: 'インフラチームに申請します。',
                type: ''
            }
        }
    };

    // Test 1: 初回取り込み
    console.log('Test 1: 初回取り込み Markdown フォーマットの検証');
    const md1 = MattermostFormatter.formatPosts(mockChannel, mockPostList, mockUserMap, {
        baseUrl: 'https://mattermost.example.com',
        isCatchUp: false
    });
    if (!md1.includes('# 💬 Mattermost ログ: 🏢 [api-platform] #APIGW 開発')) {
        throw new Error('ヘッダーが正しく生成されていません');
    }
    if (!md1.includes('@tanaka (田中 太郎)')) {
        throw new Error('発言者の氏名フォーマットが不正です');
    }
    if (!md1.includes('- 💬 **返信**')) {
        throw new Error('スレッド返信がインデント整形されていません');
    }
    console.log('  -> OK: 初回取り込みフォーマット合格');

    // Test 2: 追いつき同期
    console.log('Test 2: 追いつき同期 (Catch-up) 差分フォーマットの検証');
    const md2 = MattermostFormatter.formatPosts(mockChannel, mockPostList, mockUserMap, {
        baseUrl: 'https://mattermost.example.com',
        isCatchUp: true
    });
    if (!md2.includes('## 🔄 追いつき同期:')) {
        throw new Error('追いつき同期ヘッダーが付与されていません');
    }
    console.log('  -> OK: 追いつき同期フォーマット合格');

    // Test 3: キーワード検索結果
    console.log('Test 3: キーワード検索結果フォーマットの検証');
    const md3 = MattermostFormatter.formatPosts(mockChannel, mockPostList, mockUserMap, {
        baseUrl: 'https://mattermost.example.com',
        searchQuery: 'タイムアウト'
    });
    if (!md3.includes('# 🔎 Mattermost 検索結果: "タイムアウト"')) {
        throw new Error('検索結果ヘッダーが付与されていません');
    }
    console.log('  -> OK: 検索結果フォーマット合格');

    console.log('=== 全 Mattermost 単体テストに合格しました (All tests passed) ===');
}

runMattermostTests();
