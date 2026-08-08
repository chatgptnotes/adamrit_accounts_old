import { PatientFeedbackConsole } from "@/components/patient-feedback/PatientFeedbackConsole";

/**
 * Patient Feedback — search a patient, upload their photo or video feedback
 * with a caption, and browse everything captured so far. Same console as the
 * tablet tile so the two editions cannot drift.
 */
export default function PatientFeedback() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Patient Feedback</h1>
        <p className="text-sm text-muted-foreground">
          Photo &amp; video feedback from patients
        </p>
      </div>
      <PatientFeedbackConsole />
    </div>
  );
}
