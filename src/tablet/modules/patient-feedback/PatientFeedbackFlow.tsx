import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { PatientFeedbackConsole } from "@/components/patient-feedback/PatientFeedbackConsole";

/** Patient Feedback: search a patient, upload photo/video feedback with a caption. */
export default function PatientFeedbackFlow() {
  return (
    <FlowScaffold
      heading="Patient Feedback"
      subheading="Photo & video feedback from patients"
    >
      <PatientFeedbackConsole />
    </FlowScaffold>
  );
}
