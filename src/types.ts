export interface SystemKnowledge {
    id: string;
    name: string;
    path: string; // Relative path in Obsidian vault
    description: string;
    tags: string[];
    content?: string;
}

export interface DocumentTemplate {
    id: string;
    title: string;
    path: string; // Relative path in Obsidian vault
    description: string;
    tags: string[];
    content?: string;
}

export interface NotebookMetadata {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
    icon: string;
    description: string;
    linkedNotebookIds?: string[];
    activeSessionId?: string;
    boundFolderPath?: string; // 🗄️ Notebook単位のバインド外部フォルダ絶対パス (CIFS/ローカル共有)
    boundMmChannels?: MattermostChannelRef[]; // 💬 ノートブック単位のバインドMattermostチャンネル一覧
    systemId?: string; // 後方互換用
    templateId?: string; // 後方互換用
}

export interface ChatSessionMetadata {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount?: number;
}

export interface ChatSession extends ChatSessionMetadata {
    /**
     * CLI 側の会話セッションID (UUID)。
     * プラグイン側で採番し、初回は --session-id、2回目以降は --resume に渡す。
     * これにより対話履歴をテキストで再注入する必要がなくなる。
     */
    agentSessionId?: string;
    messages: ChatMessage[];
}

export interface LinkedArtifact {
    name: string;
    title: string;
    path: string; // Relative path in Obsidian vault
    absolutePath?: string; // Absolute filesystem path
    size?: number; // File size in bytes
    content?: string; // Optional (legacy or explicit retrieval)
}

export interface LinkedContext {
    notebookId: string;
    notebookTitle: string;
    description: string;
    artifacts: LinkedArtifact[];
}

export interface SourceOrigin {
    connectorId: 'box' | 'confluence' | 'cifs' | 'web';
    remoteUrl: string;       // ブラウザで開けるURL (出典表示・再訪用)
    remoteId: string;        // Box file_id / Confluence pageId / CIFS絶対パス
    relativeFolder?: string; // バインド起点からの相対フォルダ（例: "2024/NDPシステム_基盤更改"）
    remoteVersion?: string;  // etag / contentVersion / mtime (差分検知用)
    lastSyncedAt: string;    // 最終同期日時
}

export interface SourceItemRef {
    connectorId: 'box' | 'confluence' | 'cifs' | 'web';
    remoteId: string;
    remoteUrl: string;
    title: string;
    mimeType: string;
    remoteVersion?: string;
}

export interface SourceConnectorAdapter {
    id: string;
    name: string;
    isConfigured(settings: AINotebookSettings, secrets: Record<string, string>): boolean;
    resolveFromUrl(url: string): Promise<SourceItemRef[]>;
    download(item: SourceItemRef): Promise<{ buffer: ArrayBuffer; filename: string }>;
}

export interface TranscriptionErrorEntry {
    fileName: string;
    fileSize: number;
    actualBytesRead: number;
    errorMessage: string;
    stackTrace?: string;
    timestamp: string;
}

export interface NotebookSource {
    name: string;
    path: string; // Relative path in Obsidian vault
    extension: string;
    size: number;
    addedAt: string;
    origin?: SourceOrigin;
    convertedFrom?: string; // バイナリから変換された場合の元ファイル名
    transcriptionError?: TranscriptionErrorEntry; // 変換失敗時のエラー詳細
}

export interface AddSourceResult {
    file: any; // TFile
    isConverted: boolean;
    convertedFilename?: string;
    transcriptionFailed?: boolean;
    error?: string;
    metrics?: { durationMs: number; lineCount: number; charCount: number };
}

export interface NotebookArtifact {
    id: string;
    title: string;
    path: string; // Relative path in Obsidian vault
    type: 'note' | 'report' | 'summary' | 'custom';
    createdAt: string;
    updatedAt: string;
}

export interface AgentDebugInfo {
    agentId: string;
    command: string;
    exePath: string;
    args: string[];
    cwd: string;
    prompt: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    error?: string;
    /** stream-json から抽出したツール実行の痕跡 (例: "Write artifacts/x.md") */
    toolUses?: string[];
    /** CLI 側セッションID */
    sessionId?: string;
}

export interface ChatMessage {
    id: string;
    sender: 'user' | 'agent' | 'system';
    text: string;
    timestamp: string;
    artifactsGenerated?: string[]; // 生成・更新された成果物ファイル名一覧
    linkedNotebookIds?: string[];  // 実行時に参照していたノートブックID一覧
    debugInfo?: AgentDebugInfo;    // 実行ログ・デバッグ情報
}

export type AIAgentType = 'antigravity' | 'claude';

/**
 * エージェントの実行モード。
 * Claude Code の --permission-mode にそのまま対応させる。
 * 振る舞いをプロンプトで指示するのではなく、CLI 本来の権限モードで表現する。
 *   consult -> plan              (読み取りのみ。計画を返す)
 *   build   -> bypassPermissions (成果物を作成・編集する)
 */
export type AgentMode = 'consult' | 'build';

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
    consult: '相談',
    build: '作成'
};

export interface MattermostChannelRef {
    teamId: string;
    teamName: string;
    channelId: string;
    channelName: string;
    displayName: string;
    lastSyncedPostId?: string;
    lastSyncedAt?: string; // ISO 8601 または タイムスタンプ文字列
    sourceFileName?: string; // sources/配下のファイル名 (例: mattermost_apigw-dev.md)
}

export interface MattermostPreset {
    id: string;
    name: string;
    channels: {
        teamId: string;
        teamName: string;
        channelId: string;
        channelName: string;
        displayName: string;
    }[];
}

export interface MattermostTeam {
    id: string;
    name: string;
    display_name: string;
    description?: string;
}

export interface MattermostChannel {
    id: string;
    team_id: string;
    name: string;
    display_name: string;
    type: 'O' | 'P' | 'D' | 'G'; // Open, Private, Direct, Group
    purpose?: string;
    header?: string;
}

export interface MattermostPost {
    id: string;
    create_at: number;
    update_at: number;
    delete_at: number;
    edit_at: number;
    user_id: string;
    channel_id: string;
    root_id: string;
    original_id: string;
    message: string;
    type: string;
    props?: Record<string, any>;
    hashtags?: string;
    filenames?: string[];
    file_ids?: string[];
}

export interface MattermostPostList {
    order: string[];
    posts: Record<string, MattermostPost>;
    next_post_id?: string;
    prev_post_id?: string;
}

export interface MattermostUser {
    id: string;
    username: string;
    first_name?: string;
    last_name?: string;
    nickname?: string;
    email?: string;
}

export interface AINotebookSettings {
    rootDir: string;
    activeAgent: AIAgentType;
    antigravityPath: string;
    claudePath: string;
    defaultModel: string;
    sharedFolderBasePath?: string; // CIFS / ローカル共有フォルダの起点パス
    mattermostUrl?: string;        // Mattermost サーバーURL (例: https://mattermost.internal.company.com)
    mattermostToken?: string;      // Personal Access Token (PAT)
    mattermostPresets?: MattermostPreset[]; // お気に入りチャンネルセット
    enableDebugActions?: boolean;  // 🛠️ デバッグ動線・切り分けログの有効化（将来着脱容易）
}

export const DEFAULT_SETTINGS: AINotebookSettings = {
    rootDir: '_ainotebook',
    activeAgent: 'antigravity',
    antigravityPath: 'agy',
    claudePath: 'claude',
    defaultModel: '',
    sharedFolderBasePath: '',
    mattermostUrl: '',
    mattermostToken: '',
    mattermostPresets: [],
    enableDebugActions: true
};


