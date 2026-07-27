import { useEffect, useRef, useState } from "react";
import { Camera, Copy, ExternalLink, ImagePlus, QrCode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  type PaymentProofSelection,
  type PaymentProofSource,
} from "@/lib/paymentProof";
import { InvoiceCamera } from "@/tablet/modules/expense-bills/InvoiceCamera";

interface PaymentSupportPanelProps {
  proof: PaymentProofSelection | null;
  onProofChange: (proof: PaymentProofSelection | null) => void;
  disabled?: boolean;
  uploadMessage?: string | null;
}

const PAYMENT_QRS = [
  {
    id: "axl",
    label: "PhonePe QR 1",
    payee: "DRM Hope Hospital Private Limited",
    upiId: "9373111709-4@axl",
    image: "/payment-qr/drm-hope-phonepe-axl.jpeg",
  },
  {
    id: "ybl",
    label: "PhonePe QR 2",
    payee: "DRM Hope Hospital PR",
    upiId: "drmhopehospital@ybl",
    image: "/payment-qr/drm-hope-phonepe-ybl.jpeg",
  },
] as const;

export function PaymentSupportPanel({
  proof,
  onProofChange,
  disabled = false,
  uploadMessage,
}: PaymentSupportPanelProps) {
  const [activeQrId, setActiveQrId] = useState<(typeof PAYMENT_QRS)[number]["id"]>("axl");
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const activeQr = PAYMENT_QRS.find((qr) => qr.id === activeQrId) ?? PAYMENT_QRS[0];

  useEffect(() => {
    if (!proof) {
      setProofPreview(null);
      return;
    }
    const preview = URL.createObjectURL(proof.file);
    setProofPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [proof]);

  const selectProof = (file: File | undefined, source: PaymentProofSource) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }
    onProofChange({ file, source });
  };

  const copyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(activeQr.upiId);
      toast.success("UPI ID copied");
    } catch {
      toast.error("Could not copy the UPI ID");
    }
  };

  return (
    <div className="no-print space-y-4">
      <section className="rounded-xl border border-purple-200 bg-purple-50/60 p-3 sm:p-4">
          <div className="mb-3 flex items-center gap-2">
            <QrCode className="h-5 w-5 text-purple-700" />
            <div>
              <h4 className="text-sm font-semibold text-gray-900">Scan to pay</h4>
              <p className="text-xs text-gray-600">Choose either hospital PhonePe QR.</p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            {PAYMENT_QRS.map((qr) => (
              <button
                key={qr.id}
                type="button"
                onClick={() => setActiveQrId(qr.id)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  activeQrId === qr.id
                    ? "border-purple-600 bg-white text-purple-800 ring-2 ring-purple-200"
                    : "border-purple-200 bg-purple-50 text-gray-700 hover:bg-white"
                }`}
              >
                {qr.label}
                <span className="mt-0.5 block truncate font-normal text-gray-500">{qr.upiId}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
            <button
              type="button"
              className="mx-auto block rounded-xl border border-gray-200 bg-white p-2 shadow-sm"
              onClick={() => window.open(activeQr.image, "_blank", "noopener,noreferrer")}
              title="Open QR at full size"
            >
              <img
                src={activeQr.image}
                alt={`${activeQr.label} for ${activeQr.payee}`}
                className="h-auto max-h-64 w-full max-w-[220px] object-contain"
              />
            </button>
            <div className="min-w-0 space-y-2 text-center sm:text-left">
              <p className="text-sm font-semibold text-gray-900">{activeQr.payee}</p>
              <p className="break-all text-xs text-gray-600">{activeQr.upiId}</p>
              <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
                <Button type="button" size="sm" variant="outline" onClick={() => void copyUpiId()}>
                  <Copy className="mr-1.5 h-4 w-4" />
                  Copy UPI ID
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(activeQr.image, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Full size
                </Button>
              </div>
            </div>
          </div>
      </section>

      <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <ImagePlus className="h-5 w-5 text-blue-700" />
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Payment invoice / proof</h4>
            <p className="text-xs text-gray-600">Optional — capture a photo or choose one from the device.</p>
          </div>
        </div>

        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            selectProof(event.target.files?.[0], "file_picker");
            event.target.value = "";
          }}
        />

        {!proof ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="min-h-11 bg-white"
              onClick={() => setCameraOpen(true)}
            >
              <Camera className="mr-2 h-4 w-4" />
              Take Photo
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="min-h-11 bg-white"
              onClick={() => galleryInputRef.current?.click()}
            >
              <ImagePlus className="mr-2 h-4 w-4" />
              Choose Image
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[96px_1fr] sm:items-center">
            {proofPreview && (
              <img
                src={proofPreview}
                alt="Selected payment proof"
                className="h-24 w-24 rounded-lg border border-gray-200 bg-white object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{proof.file.name}</p>
              <p className="text-xs text-gray-500">
                {(proof.file.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                {proof.source === "in_app_camera" ? "Camera" : "Device"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setCameraOpen(true)}
                >
                  <Camera className="mr-1.5 h-4 w-4" />
                  Replace
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  className="text-red-600 hover:text-red-700"
                  onClick={() => onProofChange(null)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        )}

        {uploadMessage && (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            {uploadMessage}
          </p>
        )}
      </section>

      <InvoiceCamera
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => onProofChange({ file, source: "in_app_camera" })}
      />
    </div>
  );
}
