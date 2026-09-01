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
    messages: ChatMessage[];
}

export interface LinkedArtifact {
    name: string;
    title: string;
    path: string;
    content: string;
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

export interface NotebookArtifact {
    id: string;
    title: string;
    path: string; // Relative path in Obsidian vault
    type: 'note' | 'report' | 'summary' | 'custom';
    createdAt: string;
    updatedAt: string;
}

export interface ChatMessage {
    id: string;
    sender: 'user' | 'agent' | 'system';
    text: string;
    timestamp: string;
    artifactsGenerated?: string[]; // 生成・更新された成果物ファイル名一覧
    linkedNotebookIds?: string[];  // 実行時に参照していたノートブックID一覧
}

export type AIAgentType = 'antigravity' | 'claude';

export interface AINotebookSettings {
    rootDir: string;
    activeAgent: AIAgentType;
    antigravityPath: string;
    claudePath: string;
    defaultModel: string;
    maxTurns: number;
    sharedFolderBasePath?: string; // CIFS / ローカル共有フォルダの起点パス
}

export const DEFAULT_SETTINGS: AINotebookSettings = {
    rootDir: '_ainotebook',
    activeAgent: 'antigravity',
    antigravityPath: 'agy',
    claudePath: 'claude',
    defaultModel: '',
    maxTurns: 15,
    sharedFolderBasePath: ''
};

