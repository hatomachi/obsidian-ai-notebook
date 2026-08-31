import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const execAsync = promisify(exec);

import { LinkedContext } from '../types';

export interface AgentOptions {
    contextDir: string;  // 当該ノートブック sources/ の絶対パス
    outputDir: string;   // 当該ノートブック artifacts/ の絶対パス
    commandPath: string; // 実行パス (agy, claude, etc.)
    linkedContexts?: LinkedContext[]; // リンクされた別ノートブックの成果物・ナレッジ群
    systemKnowledgeName?: string;     // 後方互換用
    systemKnowledgeContent?: string;  // 後方互換用
    templateTitle?: string;           // 後方互換用
    templateContent?: string;         // 後方互換用
}

export interface AgentResult {
    text: string;
    artifactsCreated?: string[];
}

export interface AIAgentAdapter {
    id: string;
    name: string;
    executePrompt(prompt: string, options: AgentOptions): Promise<AgentResult>;
}

/**
 * 拡張 PATH 環境変数を生成
 */
export function getExtendedEnv(): NodeJS.ProcessEnv {
    const home = os.homedir();
    const extraPaths = [
        path.join(home, '.local', 'bin'),
        path.join(home, '.antigravity', 'bin'),
        path.join(home, '.gemini', 'antigravity', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        '/bin'
    ];

    const currentPath = process.env.PATH || '';
    const combinedPath = extraPaths.concat(currentPath.split(':')).filter(Boolean);
    const uniquePath = Array.from(new Set(combinedPath)).join(':');

    return {
        ...process.env,
        PATH: uniquePath
    };
}

/**
 * コマンド名から実際の実行パスを解決（agy / antigravity の相互フォールバック対応）
 */
export function resolveCommandPath(command: string): string {
    if (path.isAbsolute(command)) {
        return command;
    }

    const candidates = [command];
    if (command === 'antigravity' || command === 'agy') {
        candidates.push('agy', 'antigravity');
    }
    const uniqueCandidates = Array.from(new Set(candidates));

    const home = os.homedir();
    const searchDirs = [
        path.join(home, '.local', 'bin'),
        path.join(home, '.antigravity', 'bin'),
        path.join(home, '.gemini', 'antigravity', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/usr/bin',
        '/bin'
    ];

    for (const cand of uniqueCandidates) {
        for (const dir of searchDirs) {
            const fullPath = path.join(dir, cand);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
    }

    return command;
}

/**
 * プロンプトエスケープ
 */
export function escapePrompt(promptText: string): string {
    return promptText
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
}
