import { div, el, span, button } from '../utils/dom';
import { GitLabConfig, testGitLabConnection } from '../adapters/GitLabViewerAdapter';

export type WebStorageMode = 'gitlab' | 'mock';

export interface SettingsModalProps {
    isOpen: boolean;
    activeMode: WebStorageMode;
    gitlabConfig: GitLabConfig;
    onSave: (mode: WebStorageMode, config: GitLabConfig) => void;
    onClose: () => void;
}

export class SettingsModal {
    private modalEl: HTMLElement | null = null;
    private backdropEl: HTMLElement | null = null;

    open(props: SettingsModalProps): void {
        this.close();

        let currentMode = props.activeMode;
        let currentConfig = { ...props.gitlabConfig };

        const backdrop = div({ cls: 'ai-notebook-modal-backdrop' }, document.body);
        const modal = div({ cls: 'ai-notebook-modal' }, backdrop);
        this.backdropEl = backdrop;
        this.modalEl = modal;

        // Header
        const header = div({ cls: 'ai-notebook-modal-header' }, modal);
        el('h2', { text: '⚙️ GitLab 同期・閲覧設定', cls: 'ai-notebook-modal-title' }, header);
        const closeBtn = button({ text: '✕', cls: 'ai-notebook-modal-close-btn' }, header);
        closeBtn.addEventListener('click', () => {
            this.close();
            props.onClose();
        });

        // Content
        const body = div({ cls: 'ai-notebook-modal-body' }, modal);

        // Mode selector
        const modeSection = div({ cls: 'ai-notebook-form-group' }, body);
        el('label', { text: '動作モード', cls: 'ai-notebook-form-label' }, modeSection);
        const modeSelector = div({ cls: 'ai-notebook-mode-selector' }, modeSection);

        const gitlabModeBtn = button({
            text: '🦊 GitLab (社内)',
            cls: ['ai-notebook-mode-btn', currentMode === 'gitlab' ? 'active' : ''],
        }, modeSelector);

        const mockModeBtn = button({
            text: '📱 Local モック',
            cls: ['ai-notebook-mode-btn', currentMode === 'mock' ? 'active' : ''],
        }, modeSelector);

        // GitLab Config Container
        const gitlabContainer = div({ cls: 'ai-notebook-gitlab-settings' }, body);
        if (currentMode === 'mock') {
            gitlabContainer.style.display = 'none';
        }

        gitlabModeBtn.addEventListener('click', () => {
            currentMode = 'gitlab';
            gitlabModeBtn.classList.add('active');
            mockModeBtn.classList.remove('active');
            gitlabContainer.style.display = 'block';
        });

        mockModeBtn.addEventListener('click', () => {
            currentMode = 'mock';
            mockModeBtn.classList.add('active');
            gitlabModeBtn.classList.remove('active');
            gitlabContainer.style.display = 'none';
        });

        // 1. GitLab Base URL
        const urlGroup = div({ cls: 'ai-notebook-form-group' }, gitlabContainer);
        el('label', { text: 'GitLab URL / ALB リバースプロキシ', cls: 'ai-notebook-form-label' }, urlGroup);
        const urlInput = el('input', {
            type: 'text',
            placeholder: 'https://gitlab.example.com または /ainotebook/api',
            value: currentConfig.baseUrl || '',
            cls: 'ai-notebook-input',
        }, urlGroup);
        urlInput.addEventListener('input', (e) => {
            currentConfig.baseUrl = (e.target as HTMLInputElement).value;
        });
        el('p', {
            text: '※ 末尾の /api/v4 は自動付与されます。ALB経由の場合は相対パス（例: /api）も利用可能。',
            cls: 'ai-notebook-form-hint',
        }, urlGroup);

        // 2. Project ID
        const projectGroup = div({ cls: 'ai-notebook-form-group' }, gitlabContainer);
        el('label', { text: 'Project ID / Path', cls: 'ai-notebook-form-label' }, projectGroup);
        const projectInput = el('input', {
            type: 'text',
            placeholder: '数値ID (例: 1234) または group/project-name',
            value: currentConfig.projectId || '',
            cls: 'ai-notebook-input',
        }, projectGroup);
        projectInput.addEventListener('input', (e) => {
            currentConfig.projectId = (e.target as HTMLInputElement).value;
        });

        // 3. Branch
        const branchGroup = div({ cls: 'ai-notebook-form-group' }, gitlabContainer);
        el('label', { text: 'ブランチ名', cls: 'ai-notebook-form-label' }, branchGroup);
        const branchInput = el('input', {
            type: 'text',
            placeholder: 'main',
            value: currentConfig.branch || 'main',
            cls: 'ai-notebook-input',
        }, branchGroup);
        branchInput.addEventListener('input', (e) => {
            currentConfig.branch = (e.target as HTMLInputElement).value;
        });

        // 4. Personal Access Token
        const tokenGroup = div({ cls: 'ai-notebook-form-group' }, gitlabContainer);
        el('label', { text: 'Personal Access Token (PAT)', cls: 'ai-notebook-form-label' }, tokenGroup);
        const tokenInputWrapper = div({ cls: 'ai-notebook-token-wrapper' }, tokenGroup);
        const tokenInput = el('input', {
            type: 'password',
            placeholder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
            value: currentConfig.token || '',
            cls: 'ai-notebook-input',
        }, tokenInputWrapper);
        tokenInput.addEventListener('input', (e) => {
            currentConfig.token = (e.target as HTMLInputElement).value;
        });

        const toggleTokenBtn = button({ text: '👁️', cls: 'ai-notebook-token-toggle-btn' }, tokenInputWrapper);
        toggleTokenBtn.addEventListener('click', () => {
            if (tokenInput.type === 'password') {
                tokenInput.type = 'text';
                toggleTokenBtn.textContent = '🔒';
            } else {
                tokenInput.type = 'password';
                toggleTokenBtn.textContent = '👁️';
            }
        });
        el('p', {
            text: '※ 必要スコープ: read_api または read_repository。トークンは端末の localStorage にのみ保存されます。',
            cls: 'ai-notebook-form-hint',
        }, tokenGroup);

        // 5. Root Dir
        const rootGroup = div({ cls: 'ai-notebook-form-group' }, gitlabContainer);
        el('label', { text: 'ルートフォルダ名', cls: 'ai-notebook-form-label' }, rootGroup);
        const rootInput = el('input', {
            type: 'text',
            placeholder: '_ainotebook',
            value: currentConfig.rootDir || '_ainotebook',
            cls: 'ai-notebook-input',
        }, rootGroup);
        rootInput.addEventListener('input', (e) => {
            currentConfig.rootDir = (e.target as HTMLInputElement).value;
        });

        // Test Connection Section
        const testSection = div({ cls: 'ai-notebook-test-section' }, gitlabContainer);
        const testBtn = button({ text: '🔌 接続テストを実行', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, testSection);
        const testResult = div({ cls: 'ai-notebook-test-result' }, testSection);

        testBtn.addEventListener('click', async () => {
            testResult.textContent = '⏳ 接続テスト中...';
            testResult.className = 'ai-notebook-test-result info';
            testBtn.disabled = true;

            const res = await testGitLabConnection(currentConfig);
            testBtn.disabled = false;
            testResult.textContent = res.message;
            testResult.className = `ai-notebook-test-result ${res.success ? 'success' : 'error'}`;
        });

        // Footer Actions
        const footer = div({ cls: 'ai-notebook-modal-footer' }, modal);
        const cancelBtn = button({ text: 'キャンセル', cls: 'ai-notebook-btn ai-notebook-btn-secondary' }, footer);
        cancelBtn.addEventListener('click', () => {
            this.close();
            props.onClose();
        });

        const saveBtn = button({ text: '保存して適用', cls: 'ai-notebook-btn ai-notebook-btn-primary' }, footer);
        saveBtn.addEventListener('click', () => {
            props.onSave(currentMode, currentConfig);
            this.close();
        });

        // Click outside backdrop to close
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                this.close();
                props.onClose();
            }
        });
    }

    close(): void {
        if (this.backdropEl && this.backdropEl.parentNode) {
            this.backdropEl.parentNode.removeChild(this.backdropEl);
        }
        this.backdropEl = null;
        this.modalEl = null;
    }
}
