import { useEffect, useMemo, useRef, useState } from 'react';
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

interface StickerDetails {
  brandName: string;
  manufacturerName: string;
  manufacturerAddress: string;
  primaryCatNo: string;
  primaryQuantity: string;
  primaryMrp: string;
  primaryBatchNo: string;
  secondaryCatNo: string;
  secondaryImplantName: string;
  secondaryQuantity: string;
  secondaryMrp: string;
  secondaryBatchNo: string;
  mfgLicenceNo: string;
  mfgDate: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const makeDefaultDetails = (implantName: string): StickerDetails => ({
  brandName: 'YIPL',
  manufacturerName: 'YOGESHWAR IMPLANT (I) PVT LTD',
  manufacturerAddress: 'Address as per manufacturer label',
  primaryCatNo: '2435',
  primaryQuantity: '01 Plate & 03 PC Screw',
  primaryMrp: '20000-PER PC',
  primaryBatchNo: 'CS0789/465725',
  secondaryCatNo: '2438',
  secondaryImplantName: implantName || 'Titanium Screws',
  secondaryQuantity: '03 PCS',
  secondaryMrp: '650-PER PC',
  secondaryBatchNo: 'CS0789/465726',
  mfgLicenceNo: 'MFG. LIC. NO.: MH/102316',
  mfgDate: 'Dt: 19/08/2017',
});

const normalizeDetails = (details: Record<string, string> | undefined, implantName: string): StickerDetails => ({
  ...makeDefaultDetails(implantName),
  ...(details || {}),
});

const barcodeBars = Array.from({ length: 34 }, (_, index) => (index % 5 === 0 ? 3 : index % 3 === 0 ? 2 : 1));

function Barcode({ value }: { value: string }) {
  return (
    <div className="inline-flex h-[18px] items-stretch gap-[2px] bg-white px-1 py-[2px] align-middle">
      {barcodeBars.map((width, index) => (
        <span key={`${value}-${index}`} className="bg-black" style={{ width }} />
      ))}
    </div>
  );
}

function NonSterileIcon() {
  return (
    <div className="flex h-11 w-11 items-center justify-center bg-white text-black">
      <div className="relative h-8 w-8 border border-black">
        <div className="absolute inset-1 rotate-45 border border-black" />
        <div className="absolute inset-0 flex items-center justify-center text-[6px] font-bold leading-none">
          NON
          <br />
          STERILE
        </div>
      </div>
    </div>
  );
}

function FactoryIcon() {
  return (
    <div className="flex h-11 w-12 flex-col items-center justify-center bg-black text-white">
      <div className="mb-[2px] flex h-5 w-8 items-end gap-[2px]">
        <span className="h-3 w-2 bg-white" />
        <span className="h-5 w-2 bg-white" />
        <span className="h-2 w-3 bg-white" />
      </div>
      <span className="text-[6px] font-bold leading-none">DESIGN</span>
      <span className="text-[6px] font-bold leading-none">FACTORY</span>
    </div>
  );
}

function ManufacturerLogo() {
  return (
    <div className="relative h-9 w-9 overflow-hidden rounded bg-white">
      <div className="absolute inset-y-0 right-0 w-3 bg-[#8cc63f]" />
      <div className="absolute left-1 top-1 h-7 w-7 rounded-full border-[5px] border-[#2d5aa3]" />
      <div className="absolute left-[14px] top-[12px] h-3 w-3 rounded-full bg-[#5d6a7a]" />
    </div>
  );
}

function BrandStrip({ brandName }: { brandName: string }) {
  return (
    <div className="flex h-11 items-center justify-around border border-[#00ff55] bg-[#0900ff]">
      {[0, 1, 2].map((item) => (
        <span key={item} className="relative text-[24px] font-black leading-none text-[#39ff14]">
          {brandName}
          <sup className="absolute -right-3 -top-2 text-[8px] text-white">R</sup>
        </span>
      ))}
    </div>
  );
}

function ImplantLabelBlock({
  details,
  implantName,
  catNo,
  quantity,
  mrp,
  batchNo,
}: {
  details: StickerDetails;
  implantName: string;
  catNo: string;
  quantity: string;
  mrp: string;
  batchNo: string;
}) {
  return (
    <section className="relative mx-auto h-[222px] w-[455px] bg-black text-white">
      <div className="absolute left-[128px] top-0 flex items-center gap-1 text-[10px] font-bold">
        <Barcode value={batchNo} />
        <span>{catNo}</span>
      </div>

      <div className="absolute left-[16px] top-[38px] w-[270px] text-[11px] leading-tight">
        <div className="font-bold">CAT NO. {catNo}</div>
        <div className="mt-2 text-[14px] font-semibold">{implantName}</div>
        <div className="mt-3 font-bold">ITEM: {implantName}</div>
        <div className="mt-2 font-bold">QTY: {quantity}</div>
        <div className="mt-2 font-bold">MRP: {mrp}</div>
        <div className="mt-2 font-bold">BATCH No: {batchNo}</div>
        <div className="mt-2 text-[9px] font-bold">{details.mfgLicenceNo}</div>
      </div>

      <div className="absolute left-[205px] top-[62px] flex items-end gap-3">
        <NonSterileIcon />
        <FactoryIcon />
      </div>

      <div className="absolute right-[56px] top-[44px]">
        <ManufacturerLogo />
      </div>
      <div className="absolute right-4 top-[92px] origin-top-right rotate-[-90deg] whitespace-nowrap text-[10px] font-bold text-[#0a31ff]">
        {details.manufacturerName}
      </div>
      <div className="absolute right-1 top-[92px] origin-top-right rotate-[-90deg] whitespace-nowrap text-[7px] font-bold text-[#0a31ff]">
        {details.manufacturerAddress}
      </div>

      <div className="absolute bottom-[36px] left-0 right-0">
        <BrandStrip brandName={details.brandName} />
      </div>
      <div className="absolute bottom-1 left-[140px] text-[9px] font-bold">{details.mfgDate}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

export function ImplantStickerSection({
  visitId,
  patient,
  defaultSurgeryDate,
  defaultSurgeryName,
}: ImplantStickerSectionProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batchNumbers, setBatchNumbers] = useState('');
  const [surgeryDate, setSurgeryDate] = useState(defaultSurgeryDate);
  const [surgeryName, setSurgeryName] = useState(defaultSurgeryName);
  const [details, setDetails] = useState<StickerDetails>(() => makeDefaultDetails(defaultSurgeryName));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const saved = await fetchImplantStickerByVisit(visitId);
        if (cancelled) return;
        if (saved) {
          const nextSurgeryName = saved.surgeryName || defaultSurgeryName;
          setBatchNumbers(saved.batchNumbers);
          setSurgeryDate(saved.surgeryDate || defaultSurgeryDate);
          setSurgeryName(nextSurgeryName);
          setDetails(normalizeDetails(saved.details, nextSurgeryName));
        } else {
          setSurgeryDate(defaultSurgeryDate);
          setSurgeryName(defaultSurgeryName);
          setDetails(makeDefaultDetails(defaultSurgeryName));
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

  const surgeryDateLabel = useMemo(
    () => (surgeryDate ? new Date(surgeryDate).toLocaleDateString('en-IN') : ''),
    [surgeryDate],
  );

  const updateDetail = (key: keyof StickerDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveImplantSticker({ visitId, batchNumbers, surgeryDate, surgeryName, details });
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
    if (!printWindow || !printRef.current) return;
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join('');
    printWindow.document.write(`
      <html>
        <head>
          <title>Implant Sticker - ${escapeHtml(patient.patientName)}</title>
          ${styles}
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 18px; background: white; }
            @page { size: A4 portrait; margin: 10mm; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${printRef.current.outerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading implant sticker...</div>;
  }

  return (
    <div className="w-[210mm] max-w-full shrink-0 bg-white shadow-lg print:hidden">
      <div className="p-6" style={{ fontFamily: 'Arial, sans-serif' }}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={handlePrint} className="rounded bg-green-500 px-4 py-2 text-sm font-bold text-white hover:bg-green-600">
            Print Implant Sticker
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Implant Sticker'}
          </button>
        </div>

        <div ref={printRef} className="bg-white p-4 text-black">
          <div className="mb-3 text-center">
            <h2 className="text-lg font-bold tracking-wide">{patient.hospitalName}</h2>
            <div className="text-xs font-semibold">{patient.patientName} | {patient.patientId} | DOA {patient.admissionDate}</div>
          </div>

          <div className="mx-auto w-[520px] max-w-full bg-black px-8 py-5">
            <ImplantLabelBlock
              details={details}
              implantName={surgeryName || defaultSurgeryName || details.secondaryImplantName}
              catNo={details.primaryCatNo}
              quantity={details.primaryQuantity}
              mrp={details.primaryMrp}
              batchNo={details.primaryBatchNo}
            />
            <div className="h-6" />
            <ImplantLabelBlock
              details={details}
              implantName={details.secondaryImplantName}
              catNo={details.secondaryCatNo}
              quantity={details.secondaryQuantity}
              mrp={details.secondaryMrp}
              batchNo={details.secondaryBatchNo}
            />
          </div>

          <div className="mx-auto mt-4 grid w-[520px] max-w-full grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <div><strong>Batch Numbers:</strong> {batchNumbers}</div>
            <div><strong>Date of surgery:</strong> {surgeryDateLabel}</div>
            <div className="col-span-2"><strong>Name of Implant:</strong> {surgeryName}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <Field label="Implant Name" value={surgeryName} onChange={setSurgeryName} />
          <Field label="Batch Numbers" value={batchNumbers} onChange={setBatchNumbers} />
          <label className="block space-y-1">
            <span className="block text-xs font-semibold text-gray-500">Date of surgery</span>
            <input
              type="date"
              value={surgeryDate}
              onChange={(event) => setSurgeryDate(event.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          <Field label="Brand" value={details.brandName} onChange={(value) => updateDetail('brandName', value)} />
          <Field label="Manufacturer" value={details.manufacturerName} onChange={(value) => updateDetail('manufacturerName', value)} />
          <Field label="Address" value={details.manufacturerAddress} onChange={(value) => updateDetail('manufacturerAddress', value)} />
          <Field label="Primary Cat No." value={details.primaryCatNo} onChange={(value) => updateDetail('primaryCatNo', value)} />
          <Field label="Primary Qty" value={details.primaryQuantity} onChange={(value) => updateDetail('primaryQuantity', value)} />
          <Field label="Primary MRP" value={details.primaryMrp} onChange={(value) => updateDetail('primaryMrp', value)} />
          <Field label="Primary Batch" value={details.primaryBatchNo} onChange={(value) => updateDetail('primaryBatchNo', value)} />
          <Field label="Second Cat No." value={details.secondaryCatNo} onChange={(value) => updateDetail('secondaryCatNo', value)} />
          <Field label="Second Implant" value={details.secondaryImplantName} onChange={(value) => updateDetail('secondaryImplantName', value)} />
          <Field label="Second Qty" value={details.secondaryQuantity} onChange={(value) => updateDetail('secondaryQuantity', value)} />
          <Field label="Second MRP" value={details.secondaryMrp} onChange={(value) => updateDetail('secondaryMrp', value)} />
          <Field label="Second Batch" value={details.secondaryBatchNo} onChange={(value) => updateDetail('secondaryBatchNo', value)} />
          <Field label="MFG Licence" value={details.mfgLicenceNo} onChange={(value) => updateDetail('mfgLicenceNo', value)} />
          <Field label="MFG Date" value={details.mfgDate} onChange={(value) => updateDetail('mfgDate', value)} />
        </div>
      </div>
    </div>
  );
}

export default ImplantStickerSection;
