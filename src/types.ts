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

export interface NotebookSource {
    name: string;
    path: string; // Relative path in Obsidian vault
    extension: string;
    size: number;
    addedAt: string;
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
    artifactsGenerated?: string[];
}

export type AIAgentType = 'antigravity' | 'claude';

export interface AINotebookSettings {
    rootDir: string;
    activeAgent: AIAgentType;
    antigravityPath: string;
    claudePath: string;
    defaultModel: string;
}

export const DEFAULT_SETTINGS: AINotebookSettings = {
    rootDir: '_ainotebook',
    activeAgent: 'antigravity',
    antigravityPath: 'agy',
    claudePath: 'claude',
    defaultModel: ''
};
