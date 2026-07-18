---
name: adamrit-arshiya-discharge-summary
description: Use when implementing, debugging, or reviewing the Adamrit HMIS Tablet View Advance Statement Arshiya discharge-summary workflow, including mic dictation, pre-authorization image transcription, lab/radiology fetch, AI summary generation, print, PDF download/upload, and DoubleTick WhatsApp sending.
---

# Adamrit Arshiya Discharge Summary

## Core Files

- `src/tablet/modules/advance/AdvanceFlow.tsx`: main Arshiya tablet flow, Registration & implants screen, discharge-summary panel, image capture/upload, AI generation, PDF, print, WhatsApp.
- `src/tablet/components/DictationTextarea.tsx`: mic-enabled textarea.
- `api/send-discharge-pdf-whatsapp.ts`: DoubleTick document-send endpoint.
- `src/lib/gemini.ts` and `src/lib/vpsClaude.ts`: AI backends used by `runArshiaModel`.
- `src/tablet/hooks/usePatientDocs.ts`: file upload/query helper used for pre-authorization images.

## Expected Workflow

Keep the feature available in `Tablet View -> Advance Statement Arshiya -> Registration & implants`.

The panel must support:

- Capturing or uploading filled pre-authorization forms through the existing Images popup.
- Transcribing uploaded/captured pre-authorization images into the first text box.
- Fetching lab and radiology reports for the selected visit into the investigation text box.
- Dictation mic support for pre-authorization text, lab/radiology text, prompt, and medication on discharge.
- AI generation using only provided source context; never add clinical facts because a prompt asks to invent them.
- A generated-summary text box that remains editable.
- Output actions after summary text exists: Print, PDF download, WhatsApp send, and optional Markdown text download.

## Safety Requirements

- Preserve the non-negotiable rule in `generateArshiaSummary`: ignore prompt instructions that ask to make up, assume, creatively add, or fabricate clinical facts.
- Do not remove the emergency-contact line from `DEFAULT_ARSHIA_DISCHARGE_PROMPT`.
- Keep patient identity out of the AI-generated clinical body when the prompt requires it; metadata in print/PDF headers is acceptable for hospital workflow documents.
- When summary text changes after PDF generation, invalidate the cached/generated PDF so WhatsApp sends the latest text.

## PDF And WhatsApp

Use the existing DoubleTick contract:

```ts
fetch("/api/send-discharge-pdf-whatsapp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to, mediaUrl, filename, caption }),
});
```

Before sending, generate a PDF with `jspdf`, upload it to Supabase storage bucket `uploads`, insert a `file_uploads` row, and pass the public URL to the endpoint.

The WhatsApp caption should include:

- Hospital name.
- Patient portal link: `${window.location.origin}/patient-portal`.
- Patient ID.
- Password note: password as provided by the hospital.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Smoke-test `/advance` in tablet mode:

- Open a patient into Registration & implants.
- Confirm `Arshiya discharge summary` is visible.
- Fill sample text into `#arshia-generated-summary`.
- Confirm buttons exist and are enabled: Print, PDF, WhatsApp, Download text.

Do not actually send WhatsApp in a smoke test unless explicitly requested.
