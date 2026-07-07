declare module 'piexifjs' {
  export const GPSIFD: {
    GPSLatitudeRef: number;
    GPSLatitude: number;
    GPSLongitudeRef: number;
    GPSLongitude: number;
  };

  export function load(dataUrl: string): { GPS: Record<number, unknown>; [key: string]: unknown };
  export function dump(exifObj: Record<string, unknown>): string;
  export function insert(exifBytes: string, dataUrl: string): string;
}
