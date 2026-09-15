import { AIAgentAdapter } from './AgentAdapter';
import { AntigravityCliAdapter } from './AntigravityCliAdapter';
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter';
import { CopilotCliAdapter } from './CopilotCliAdapter';
import { AINotebookSettings } from '../types';

export class AgentFactory {
    static getAdapter(settings: AINotebookSettings): AIAgentAdapter {
        if (settings.activeAgent === 'claude') {
            return new ClaudeCodeAdapter();
        }
        if (settings.activeAgent === 'copilot') {
            return new CopilotCliAdapter();
        }
        return new AntigravityCliAdapter();
    }

    static getCommandPath(settings: AINotebookSettings): string {
        if (settings.activeAgent === 'claude') {
            return settings.claudePath || 'claude';
        }
        if (settings.activeAgent === 'copilot') {
            return settings.copilotPath || 'copilot';
        }
        return settings.antigravityPath || 'agy';
    }
}
