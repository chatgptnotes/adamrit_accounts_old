import React, { useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";
import { getCorporateRegistrationDocuments } from "@/lib/registrationDocuments";
import { type RegistrationDocumentSelection } from "./types";

interface DocumentUploadSectionProps {
  corporate: string;
  documents: RegistrationDocumentSelection[];
  onFileSelect: (label: string, file: File | null) => void;
  onFileRemove: (label: string) => void;
}

export const DocumentUploadSection: React.FC<DocumentUploadSectionProps> = ({
  corporate,
  documents,
  onFileSelect,
  onFileRemove,
}) => {
  const requiredDocuments = useMemo(
    () => getCorporateRegistrationDocuments(corporate),
    [corporate],
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  if (requiredDocuments.length === 0) return null;

  return (
    <div className="bg-green-50 p-4 rounded-lg">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-green-700">Document Upload</h3>
        <p className="mt-1 text-sm text-green-900/80">
          Upload the registration documents for <span className="font-medium">{corporate}</span>. You can still save the patient if some files are pending.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {documents.map((document) => (
          <div key={document.label} className="space-y-2">
            <Label className="text-sm font-medium">{document.label}</Label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-white">
              {document.file ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-sm text-gray-700 break-all">{document.file.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        onFileRemove(document.label);
                        const input = inputRefs.current[document.label];
                        if (input) input.value = "";
                      }}
                      className="text-red-500 hover:text-red-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    type="button"
                    onClick={() => inputRefs.current[document.label]?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Change file
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    type="button"
                    onClick={() => inputRefs.current[document.label]?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Choose file
                  </Button>
                  <p className="text-xs text-gray-500 mt-1">No file chosen</p>
                </>
              )}
            </div>
            <input
              ref={(element) => {
                inputRefs.current[document.label] = element;
              }}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(event) => onFileSelect(document.label, event.target.files?.[0] || null)}
              className="hidden"
            />
          </div>
        ))}
      </div>
    </div>
  );
};
