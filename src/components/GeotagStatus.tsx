import { Loader2, MapPin, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatGeoCoords, googleMapsUrl, type GeoCapture } from '@/lib/geotag';

interface GeotagStatusProps {
  geo: GeoCapture | null;
  loading?: boolean;
  onRetry?: () => void;
  compact?: boolean;
}

export function GeotagStatus({ geo, loading, onRetry, compact }: GeotagStatusProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Getting GPS location…
      </div>
    );
  }

  if (geo) {
    return (
      <div
        className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap items-center justify-between gap-2'} rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800`}
      >
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" />
          <span>
            GPS captured:{' '}
            <a
              href={googleMapsUrl(geo)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              {formatGeoCoords(geo)}
            </a>
            {geo.accuracy != null ? ` (±${Math.round(geo.accuracy)}m)` : ''}
          </span>
        </div>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="h-7 text-xs">
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry GPS
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex ${compact ? 'flex-col gap-2' : 'flex-wrap items-center justify-between gap-2'} rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Location not captured — photo will upload without geotag.</span>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="h-7 text-xs">
          <RefreshCw className="mr-1 h-3 w-3" />
          Retry GPS
        </Button>
      )}
    </div>
  );
}
