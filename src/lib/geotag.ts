export type CaptureSource = 'in_app_camera' | 'file_picker';

export interface GeoCapture {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

/** Attempt to read device GPS. Returns null on denial, timeout, or unsupported browser. */
export function captureGeolocation(): Promise<GeoCapture | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          capturedAt: new Date().toISOString(),
        });
      },
      () => resolve(null),
      GEO_OPTIONS,
    );
  });
}

export function formatGeoCoords(geo: GeoCapture): string {
  return `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}`;
}

export function googleMapsUrl(geo: GeoCapture): string {
  return `https://maps.google.com/?q=${geo.latitude},${geo.longitude}`;
}

export function geoToDbFields(geo: GeoCapture | null, captureSource: CaptureSource | null) {
  if (!geo) {
    return {
      latitude: null,
      longitude: null,
      gps_accuracy: null,
      gps_captured_at: null,
      capture_source: captureSource,
    };
  }
  return {
    latitude: geo.latitude,
    longitude: geo.longitude,
    gps_accuracy: geo.accuracy,
    gps_captured_at: geo.capturedAt,
    capture_source: captureSource,
  };
}
