import React, { useRef, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { extractMedicationChart, type ExtractedMedicine } from '@/lib/extractMedicationChart';
import { captureGeolocation, type GeoCapture } from '@/lib/geotag';
import { geotagJpegFile } from '@/lib/embedGeotagExif';
import { GeotagStatus } from '@/components/GeotagStatus';

export type { ExtractedMedicine } from '@/lib/extractMedicationChart';

interface TreatmentSheetScanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtracted: (medicines: ExtractedMedicine[], doctor: string) => void;
}

const TreatmentSheetScanModal: React.FC<TreatmentSheetScanModalProps> = ({
  open,
  onOpenChange,
  onExtracted,
}) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [capturedGeo, setCapturedGeo] = useState<GeoCapture | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setCapturedGeo(null);
    setPreviewUrl(null);
    setExtracting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      toast({ title: 'Unsupported file', description: 'Please capture or choose an image.', variant: 'destructive' });
      return;
    }
    const geo = await captureGeolocation();
    const tagged = await geotagJpegFile(selected, geo);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedGeo(geo);
    setFile(tagged);
    setPreviewUrl(URL.createObjectURL(tagged));
  };

  const handleExtract = async () => {
    if (!file) return;
    setExtracting(true);
    try {
      const { medicines, doctor } = await extractMedicationChart(file);
      onExtracted(medicines, doctor);
      toast({ title: 'Chart scanned', description: `${medicines.length} medicine(s) added to the sheet. Review, then confirm.` });
      handleClose(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Extraction failed';
      console.error('Treatment sheet scan failed:', error);
      toast({ title: 'Scan failed', description: message, variant: 'destructive' });
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-bold">Scan Medication Chart</h2>
          </div>
          <p className="text-sm text-gray-500">
            Take a photo of the handwritten medication chart. The AI reads the medicines into the
            treatment sheet for you to review before sending to the pharmacy.
          </p>

          {previewUrl ? (
            <div className="space-y-3">
              <img
                src={previewUrl}
                alt="Captured medication chart"
                className="max-h-72 w-full rounded-lg border object-contain bg-gray-50"
              />
              <GeotagStatus geo={capturedGeo} />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={extracting}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Retake
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  onClick={handleExtract}
                  disabled={extracting}
                >
                  {extracting ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading…</>
                  ) : (
                    <><Sparkles className="mr-2 h-4 w-4" /> Extract Medicines</>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-12 text-gray-500 hover:border-blue-400 hover:bg-blue-50"
            >
              <Camera className="h-10 w-10" />
              <span className="font-medium">Tap to capture or choose a photo</span>
              <span className="text-xs">JPG / PNG of the medication chart</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TreatmentSheetScanModal;
