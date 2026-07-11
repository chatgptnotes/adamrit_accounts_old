import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchImplantStickerByVisit, saveImplantSticker } from '@/lib/implantBillDb';

interface ImplantStickerPatientInfo {
  patientName: string;
  patientId: string;
  age: string;
  sex: string;
  admissionDate: string;
  dischargeDate: string;
  hospitalName: string;
}

interface ImplantStickerSectionProps {
  visitId: string;
  patient: ImplantStickerPatientInfo;
  defaultSurgeryDate: string; // yyyy-MM-dd
  defaultSurgeryName: string;
}

export function ImplantStickerSection({
  visitId,
  patient,
  defaultSurgeryDate,
  defaultSurgeryName,
}: ImplantStickerSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batchNumbers, setBatchNumbers] = useState('');
  const [surgeryDate, setSurgeryDate] = useState(defaultSurgeryDate);
  const [surgeryName, setSurgeryName] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const saved = await fetchImplantStickerByVisit(visitId);
        if (cancelled) return;
        if (saved) {
          setBatchNumbers(saved.batchNumbers);
          setSurgeryDate(saved.surgeryDate || defaultSurgeryDate);
          setSurgeryName(saved.surgeryName || defaultSurgeryName);
        } else {
          setSurgeryDate(defaultSurgeryDate);
          setSurgeryName(defaultSurgeryName);
        }
      } catch (error) {
        console.error('Failed to load implant sticker:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [visitId, defaultSurgeryDate, defaultSurgeryName]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveImplantSticker({ visitId, batchNumbers, surgeryDate, surgeryName });
      toast.success('Implant sticker saved.');
    } catch (error) {
      console.error('Failed to save implant sticker:', error);
      toast.error('Could not save the implant sticker.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const surgeryDateLabel = surgeryDate ? new Date(surgeryDate).toLocaleDateString('en-IN') : '';
    const row = (label: string, value: string) => `
      <tr>
        <td style="width:33%">${label}</td>
        <td>${value || ''}</td>
      </tr>`;
    printWindow.document.write(`
      <html>
        <head>
          <title>Implant Sticker - ${patient.patientName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            td { border: 1px solid #000; padding: 6px 10px; }
            .pouch-title { margin-top: 20px; font-weight: bold; }
            .pouch { border: 1px solid #000; height: 90px; margin-bottom: -1px; }
            .checklist { margin-top: 20px; }
            .checklist div { margin-bottom: 6px; }
            .sign-row { display: flex; gap: 40px; margin-top: 40px; }
            .sign-row > div { flex: 1; border-top: 1px solid #000; padding-top: 4px; text-align: center; font-size: 11px; }
            @media print { @page { margin: 0.6in; } }
          </style>
        </head>
        <body>
          <h2 style="text-align:center">${patient.hospitalName}</h2>
          <table>
            ${row('Patient Name', patient.patientName)}
            ${row('Patient ID', patient.patientId)}
            ${row('Age', patient.age)}
            ${row('Sex', patient.sex)}
            ${row('DOA', patient.admissionDate)}
            ${row('DOD', patient.dischargeDate)}
            ${row('Patient Type', 'In-Patient')}
          </table>

          <div class="pouch-title">Implant Pouch (paste manufacturer sticker here)</div>
          <div class="pouch"></div>
          <div class="pouch"></div>
          <div class="pouch"></div>

          <div class="checklist">
            <div><strong>Batch Numbers:</strong> ${batchNumbers}</div>
            <div><strong>Date of surgery:</strong> ${surgeryDateLabel}</div>
            <div><strong>Name of Surgery:</strong> ${surgeryName}</div>
          </div>

          <div class="sign-row">
            <div>Signature of the operating Surgeon</div>
            <div>Stamp of the operating Surgeon</div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
    printWindow.close();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading implant sticker…</div>;
  }

  return (
    <div className="w-[210mm] max-w-full shrink-0 bg-white shadow-lg print:hidden">
      <div className="p-6" style={{ fontFamily: 'Arial, sans-serif' }}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={handlePrint} className="px-4 py-2 bg-green-500 text-white rounded font-bold hover:bg-green-600 text-sm">
            Print Implant Sticker
          </button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-500 text-white rounded font-bold hover:bg-blue-600 text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Implant Sticker'}
          </button>
        </div>

        <div className="text-center border-b-2 border-black pb-2 mb-2">
          <h2 className="text-lg font-bold tracking-wide">Implant Sticker</h2>
        </div>

        <table className="w-full text-sm border-collapse mb-3">
          <tbody>
            {[
              ['Patient Name', patient.patientName],
              ['Patient ID', patient.patientId],
              ['Age', patient.age],
              ['Sex', patient.sex],
              ['DOA', patient.admissionDate],
              ['DOD', patient.dischargeDate],
              ['Patient Type', 'In-Patient'],
            ].map(([label, value]) => (
              <tr key={label}>
                <td className="border px-2 py-1 font-semibold w-[160px] bg-gray-50">{label}</td>
                <td className="border px-2 py-1">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Batch Numbers</label>
            <input value={batchNumbers} onChange={(e) => setBatchNumbers(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1" placeholder="Batch numbers" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Date of surgery</label>
            <input type="date" value={surgeryDate} onChange={(e) => setSurgeryDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Name of Surgery</label>
            <input value={surgeryName} onChange={(e) => setSurgeryName(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1" placeholder="Surgery name" />
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Printed sticker leaves 3 blank boxes for pasting the manufacturer's implant pouch sticker, plus lines for the operating surgeon's signature and stamp.
        </p>
      </div>
    </div>
  );
}

export default ImplantStickerSection;
