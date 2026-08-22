import { AIAgentAdapter } from './AgentAdapter';
import { AntigravityCliAdapter } from './AntigravityCliAdapter';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter';
import { AINotebookSettings } from '../types';

export class AgentFactory {
    static getAdapter(settings: AINotebookSettings): AIAgentAdapter {
        if (settings.activeAgent === 'claude') {
            return new ClaudeCodeAdapter();
        }
        return new AntigravityCliAdapter();
    }

    static getCommandPath(settings: AINotebookSettings): string {
        if (settings.activeAgent === 'claude') {
            return settings.claudePath || 'claude';
        }
        return settings.antigravityPath || 'agy';
    }
}
