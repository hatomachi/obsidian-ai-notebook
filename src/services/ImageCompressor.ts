export interface ImageCompressionOptions {
    maxDimension?: number;
    quality?: number;
}

export interface ImageCompressionResult {
    data: ArrayBuffer;
    originalFilename: string;
    convertedFilename: string;
    originalSize: number;
    compressedSize: number;
    savedBytes: number;
    ratio: number; // 削減率 (パーセント: 0-100)
    width: number;
    height: number;
    durationMs: number;
}

export class ImageCompressor {
    private static readonly COMPRESSIBLE_EXTENSIONS = new Set([
        'png',
        'jpg',
        'jpeg',
        'webp',
        'bmp'
    ]);

    /**
     * 指定されたファイルが画像圧縮の対象形式かを判定 (png, jpg, jpeg, webp, bmp)
     * ※ gif, svg 等は対象外
     */
    public static isCompressible(filename: string): boolean {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        return this.COMPRESSIBLE_EXTENSIONS.has(ext);
    }

    /**
     * ファイル名を .webp 拡張子に変更
     */
    public static getWebpFilename(filename: string): string {
        const lastDotIdx = filename.lastIndexOf('.');
        if (lastDotIdx === -1) return `${filename}.webp`;
        return `${filename.substring(0, lastDotIdx)}.webp`;
    }

    /**
     * 長辺最大ピクセル数とアスペクト比を維持したリサイズ後の寸法を計算
     */
    public static calculateDimensions(
        origWidth: number,
        origHeight: number,
        maxDimension: number
    ): { width: number; height: number } {
        if (origWidth <= 0 || origHeight <= 0) {
            return { width: Math.max(1, origWidth), height: Math.max(1, origHeight) };
        }

        if (origWidth <= maxDimension && origHeight <= maxDimension) {
            return { width: origWidth, height: origHeight };
        }

        if (origWidth > origHeight) {
            const width = maxDimension;
            const height = Math.max(1, Math.round((origHeight * maxDimension) / origWidth));
            return { width, height };
        } else {
            const height = maxDimension;
            const width = Math.max(1, Math.round((origWidth * maxDimension) / origHeight));
            return { width, height };
        }
    }

    /**
     * 画像データを WebP 形式にリサイズ・圧縮
     */
    public static async compress(
        data: ArrayBuffer | Buffer,
        originalFilename: string,
        options: ImageCompressionOptions = {}
    ): Promise<ImageCompressionResult> {
        const startTime = Date.now();
        const maxDimension = options.maxDimension ?? 1200;
        const quality = options.quality ?? 0.8;

        const toArrayBuffer = (d: ArrayBuffer | Buffer): ArrayBuffer => {
            if (Buffer.isBuffer(d)) {
                const ab = new ArrayBuffer(d.length);
                const view = new Uint8Array(ab);
                for (let i = 0; i < d.length; ++i) {
                    view[i] = d[i];
                }
                return ab;
            }
            return d;
        };

        const rawBuffer = toArrayBuffer(data);
        const originalSize = rawBuffer.byteLength;

        // Node.js テスト環境など DOM / Canvas が利用不可の場合はバイパス
        const isCanvasSupported = typeof window !== 'undefined' &&
            (typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined');

        if (!isCanvasSupported) {
            const durationMs = Date.now() - startTime;
            return {
                data: rawBuffer,
                originalFilename,
                convertedFilename: this.getWebpFilename(originalFilename),
                originalSize,
                compressedSize: originalSize,
                savedBytes: 0,
                ratio: 0,
                width: 0,
                height: 0,
                durationMs
            };
        }

        const ext = originalFilename.split('.').pop()?.toLowerCase() || 'png';
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

        try {
            const blob = new Blob([rawBuffer], { type: mimeType });
            let imgWidth = 0;
            let imgHeight = 0;
            let sourceImage: ImageBitmap | HTMLImageElement;

            if (typeof createImageBitmap === 'function') {
                const bitmap = await createImageBitmap(blob);
                imgWidth = bitmap.width;
                imgHeight = bitmap.height;
                sourceImage = bitmap;
            } else {
                sourceImage = await new Promise<HTMLImageElement>((resolve, reject) => {
                    const img = new Image();
                    const url = URL.createObjectURL(blob);
                    img.onload = () => {
                        URL.revokeObjectURL(url);
                        resolve(img);
                    };
                    img.onerror = (e) => {
                        URL.revokeObjectURL(url);
                        reject(new Error(`画像のロードに失敗しました: ${e}`));
                    };
                    img.src = url;
                });
                imgWidth = sourceImage.width;
                imgHeight = sourceImage.height;
            }

            const { width, height } = this.calculateDimensions(imgWidth, imgHeight, maxDimension);

            let compressedBlob: Blob | null = null;

            if (typeof OffscreenCanvas !== 'undefined') {
                const offscreen = new OffscreenCanvas(width, height);
                const ctx = offscreen.getContext('2d');
                if (!ctx) throw new Error('OffscreenCanvas 2D context の取得に失敗しました');
                ctx.drawImage(sourceImage, 0, 0, width, height);
                compressedBlob = await offscreen.convertToBlob({ type: 'image/webp', quality });
            } else if (typeof document !== 'undefined') {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Canvas 2D context の取得に失敗しました');
                ctx.drawImage(sourceImage, 0, 0, width, height);
                compressedBlob = await new Promise<Blob | null>((resolve) => {
                    canvas.toBlob(resolve, 'image/webp', quality);
                });
            }

            if ('close' in sourceImage && typeof (sourceImage as any).close === 'function') {
                (sourceImage as ImageBitmap).close();
            }

            if (!compressedBlob) {
                throw new Error('WebP 変換後の Blob を生成できませんでした');
            }

            const compressedBuffer = await compressedBlob.arrayBuffer();
            const compressedSize = compressedBuffer.byteLength;
            const savedBytes = Math.max(0, originalSize - compressedSize);
            const ratio = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;
            const durationMs = Date.now() - startTime;

            return {
                data: compressedBuffer,
                originalFilename,
                convertedFilename: this.getWebpFilename(originalFilename),
                originalSize,
                compressedSize,
                savedBytes,
                ratio,
                width,
                height,
                durationMs
            };
        } catch (error: any) {
            console.warn(`[ImageCompressor] WebP 圧縮処理に失敗したため元データを維持します: ${error?.message || error}`);
            const durationMs = Date.now() - startTime;
            return {
                data: rawBuffer,
                originalFilename,
                convertedFilename: originalFilename,
                originalSize,
                compressedSize: originalSize,
                savedBytes: 0,
                ratio: 0,
                width: 0,
                height: 0,
                durationMs
            };
        }
    }
}
