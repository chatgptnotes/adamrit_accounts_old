import { uploadPatientDocs } from "@/tablet/hooks/usePatientDocs";

export type PaymentProofSource = "in_app_camera" | "file_picker";

export interface PaymentProofSelection {
  file: File;
  source: PaymentProofSource;
}

interface UploadPaymentProofOptions {
  proof: PaymentProofSelection;
  patientId: string;
  patientName: string | null;
  visitId: string;
  paymentKind: "advance_payment" | "final_payment";
  paymentId: string;
  uploadedBy?: string | null;
}

export async function uploadPaymentProof({
  proof,
  patientId,
  patientName,
  visitId,
  paymentKind,
  paymentId,
  uploadedBy,
}: UploadPaymentProofOptions): Promise<void> {
  const notes = [
    "PAYMENT_PROOF",
    `payment_kind:${paymentKind}`,
    `visit_id:${visitId}`,
    `payment_id:${paymentId}`,
  ].join("|");

  await uploadPatientDocs(
    [{ file: proof.file, captureSource: proof.source }],
    {
      patientId,
      patientName,
      category: "payment_proof",
      uploadedBy: uploadedBy ?? null,
      placeLabel: "Payment invoice proof",
      notes,
    },
  );
}
