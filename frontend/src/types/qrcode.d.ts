declare module 'qrcode' {
  export interface QRCodeModules {
    size: number;
    data: Uint8Array;
    get(row: number, col: number): number;
  }

  export interface QRCodeCreateOptions {
    version?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' | 'low' | 'medium' | 'quartile' | 'high';
    maskPattern?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  }

  export function create(
    text: string,
    options?: QRCodeCreateOptions,
  ): {
    modules: QRCodeModules;
    version: number;
    errorCorrectionLevel: { bit: number };
    maskPattern: number;
  };
}

