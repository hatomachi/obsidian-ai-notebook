import { App, Modal, Setting } from 'obsidian';

export class TextInputModal extends Modal {
    title: string;
    description?: string;
    placeholder?: string;
    initialValue: string;
    onSubmit: (result: string) => void;

    value: string;

    constructor(
        app: App,
        title: string,
        initialValue: string,
        onSubmit: (result: string) => void,
        options?: { description?: string; placeholder?: string }
    ) {
        super(app);
        this.title = title;
        this.initialValue = initialValue;
        this.value = initialValue;
        this.onSubmit = onSubmit;
        this.description = options?.description;
        this.placeholder = options?.placeholder;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-notebook-text-input-modal');

        contentEl.createEl('h3', { text: this.title });
        if (this.description) {
            contentEl.createEl('p', { text: this.description, cls: 'ai-notebook-hint-text' });
        }

        const textSetting = new Setting(contentEl);
        textSetting.addText(text => {
            text.setPlaceholder(this.placeholder || '')
                .setValue(this.value)
                .onChange(val => this.value = val);
            text.inputEl.style.width = '100%';
            text.inputEl.focus();
            text.inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.doSubmit();
                }
            };
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('OK')
                .setCta()
                .onClick(() => this.doSubmit()))
            .addButton(btn => btn
                .setButtonText('キャンセル')
                .onClick(() => this.close()));
    }

    private doSubmit(): void {
        const trimmed = this.value.trim();
        if (trimmed) {
            this.onSubmit(trimmed);
        }
        this.close();
    }

    onClose(): void {
        const { contentEl } = this;
        contentEl.empty();
    }
}
