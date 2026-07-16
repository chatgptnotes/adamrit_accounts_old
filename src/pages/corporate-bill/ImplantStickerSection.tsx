import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
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
  referenceLink: string;
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
  manufacturerAddress:
    'Sr.No.91 Hissa No.1 A R Building,\nShobha Complex, Rajkamal Compound,\nKalher village, Tal. Bhiwandi-14\nDistrict: Thane-421302\nMob: 9321142084',
  referenceLink: 'https://docs.google.com/drawings/d/1WdiUCtap-FuRiKIDNkXeM7LnP_gt3PAWisVIZ-ps_tE/edit',
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
const barcodeHtml = () => barcodeBars.map((width) => `<span style="width:${width}px"></span>`).join('');

const formatMultilineHtml = (value: string) => escapeHtml(value).replace(/\n/g, '<br />');

function Barcode({ value }: { value: string }) {
  return (
    <div className="inline-flex h-[18px] items-stretch gap-[2px] rounded border border-slate-300 bg-white px-1 py-[2px] align-middle">
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
    <div className="flex h-11 w-12 flex-col items-center justify-center rounded bg-slate-950 text-white">
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
    <div className="relative h-10 w-10 overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm">
      <div className="absolute inset-y-0 right-0 w-3 bg-[#8cc63f]" />
      <div className="absolute left-1.5 top-1.5 h-7 w-7 rounded-full border-[5px] border-[#3764b3]" />
      <div className="absolute left-[15px] top-[13px] h-3 w-3 rounded-full bg-[#5d6a7a]" />
    </div>
  );
}

function ManufacturerRail({ details }: { details: StickerDetails }) {
  return (
    <div className="absolute right-[7px] top-[42px] flex h-[138px] w-[60px] flex-col items-center overflow-hidden rounded-l-md border border-slate-200 bg-slate-50 px-[6px] py-[7px] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <ManufacturerLogo />
      <div className="mt-2 flex flex-1 items-center justify-center">
        <span
          className="whitespace-nowrap [writing-mode:vertical-rl] [text-orientation:mixed] text-[9px] font-extrabold leading-none tracking-[0.12em] text-[#315ef2]"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {details.manufacturerName}
        </span>
      </div>
      <div className="mt-1 flex flex-1 items-center justify-center">
        <span
          className="whitespace-pre-line [writing-mode:vertical-rl] [text-orientation:mixed] text-[6px] font-bold leading-[1.08] tracking-[0.05em] text-[#4f7df0]"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {details.manufacturerAddress}
        </span>
      </div>
    </div>
  );
}

function BrandStrip({ brandName }: { brandName: string }) {
  return (
    <div className="flex h-10 items-center justify-around border-t border-[#7bb6ff] bg-[#2f6ff2]">
      {[0, 1, 2].map((item) => (
        <span key={item} className="relative text-[22px] font-black leading-none tracking-[0.18em] text-[#dff6ff]">
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
    <section className="relative mx-auto h-[222px] w-[455px] overflow-hidden rounded-md border border-slate-900 bg-white text-slate-950 shadow-sm">
      <div className="absolute left-[128px] top-3 flex items-center gap-2 text-[10px] font-bold text-slate-700">
        <Barcode value={batchNo} />
        <span>{catNo}</span>
      </div>

      <div className="absolute left-[16px] top-[42px] w-[270px] text-[11px] leading-tight">
        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">CAT NO. {catNo}</div>
        <div className="mt-2 text-[16px] font-black text-slate-950">{implantName}</div>
        <div className="mt-3 font-bold text-slate-700">ITEM: <span className="text-slate-950">{implantName}</span></div>
        <div className="mt-2 font-bold text-slate-700">QTY: <span className="text-slate-950">{quantity}</span></div>
        <div className="mt-2 font-bold text-slate-700">MRP: <span className="text-slate-950">{mrp}</span></div>
        <div className="mt-2 font-bold text-slate-700">BATCH No: <span className="text-slate-950">{batchNo}</span></div>
        <div className="mt-2 text-[9px] font-bold text-slate-600">{details.mfgLicenceNo}</div>
      </div>

      <div className="absolute left-[205px] top-[62px] flex items-end gap-3">
        <NonSterileIcon />
        <FactoryIcon />
      </div>

      <ManufacturerRail details={details} />

      <div className="absolute bottom-[30px] left-0 right-0">
        <BrandStrip brandName={details.brandName} />
      </div>
      <div className="absolute bottom-2 left-[150px] text-[9px] font-bold text-slate-600">{details.mfgDate}</div>
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

function TextareaField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-gray-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="w-full rounded border border-gray-300 px-2 py-1 text-sm leading-5"
      />
    </label>
  );
}

function LinkField({
  label,
  value,
  onChange,
  onCopy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCopy: () => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-gray-500">{label}</span>
      <div className="flex items-stretch gap-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-gray-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          title="Copy link"
          aria-label="Copy link"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </label>
  );
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

  const handleCopyReferenceLink = async () => {
    try {
      await navigator.clipboard.writeText(details.referenceLink || '');
      toast.success('Reference link copied.');
    } catch (error) {
      console.error('Failed to copy reference link:', error);
      toast.error('Could not copy the reference link.');
    }
  };

  const renderPrintLabel = ({
    implantName,
    catNo,
    quantity,
    mrp,
    batchNo,
  }: {
    implantName: string;
    catNo: string;
    quantity: string;
    mrp: string;
    batchNo: string;
  }) => `
    <section class="label">
      <div class="barcode-row"><div class="barcode">${barcodeHtml()}</div><strong>${escapeHtml(catNo)}</strong></div>
      <div class="copy">
        <div class="meta">CAT NO. ${escapeHtml(catNo)}</div>
        <h3>${escapeHtml(implantName)}</h3>
        <p><strong>ITEM:</strong> ${escapeHtml(implantName)}</p>
        <p><strong>QTY:</strong> ${escapeHtml(quantity)}</p>
        <p><strong>MRP:</strong> ${escapeHtml(mrp)}</p>
        <p><strong>BATCH No:</strong> ${escapeHtml(batchNo)}</p>
        <p class="licence">${escapeHtml(details.mfgLicenceNo)}</p>
      </div>
      <div class="symbols">
        <div class="non-sterile"><span>NON<br/>STERILE</span></div>
        <div class="factory"><div class="factory-bars"><i></i><i></i><i></i></div><span>DESIGN</span><span>FACTORY</span></div>
      </div>
      <div class="mark"><div class="mark-green"></div><div class="mark-ring"></div><div class="mark-dot"></div></div>
      <div class="maker-rail">
        <div class="maker-logo"><div class="maker-logo-mark"></div></div>
        <div class="maker-name">${escapeHtml(details.manufacturerName)}</div>
        <div class="maker-address">${formatMultilineHtml(details.manufacturerAddress)}</div>
      </div>
      <div class="brand-strip">
        <span>${escapeHtml(details.brandName)}<sup>R</sup></span>
        <span>${escapeHtml(details.brandName)}<sup>R</sup></span>
        <span>${escapeHtml(details.brandName)}<sup>R</sup></span>
      </div>
      <div class="mfg-date">${escapeHtml(details.mfgDate)}</div>
    </section>
  `;

  const renderPrintHtml = () => `
    <html>
      <head>
        <title>Implant Sticker - ${escapeHtml(patient.patientName)}</title>
        <style>
          body { margin: 0; background: white; color: #0f172a; font-family: Arial, sans-serif; }
          .page { width: 180mm; margin: 0 auto; padding: 10mm 0; }
          .hospital { text-align: center; margin-bottom: 6mm; }
          .hospital h2 { margin: 0; font-size: 18pt; line-height: 1.15; }
          .hospital p { margin: 3px 0 0; font-size: 9pt; font-weight: 700; }
          .sheet { width: 142mm; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 10px; background: #f8fafc; padding: 7mm; }
          .label { position: relative; height: 56mm; margin: 0 auto 7mm; overflow: hidden; border: 1.2px solid #111827; border-radius: 8px; background: #fff; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.12); }
          .label:last-child { margin-bottom: 0; }
          .barcode-row { position: absolute; top: 4mm; left: 44mm; display: flex; align-items: center; gap: 3mm; font-size: 8pt; color: #475569; }
          .barcode { display: inline-flex; height: 5mm; align-items: stretch; gap: .5mm; border: 1px solid #cbd5e1; border-radius: 3px; background: #fff; padding: .8mm 1mm; }
          .barcode span { display: block; background: #000; }
          .copy { position: absolute; left: 6mm; top: 13mm; width: 78mm; font-size: 8pt; font-weight: 700; line-height: 1.3; }
          .copy .meta { font-size: 7.5pt; letter-spacing: .12em; text-transform: uppercase; color: #64748b; }
          .copy h3 { margin: 1.5mm 0 2.5mm; font-size: 12pt; line-height: 1.1; color: #020617; }
          .copy p { margin: 1.2mm 0; color: #334155; }
          .copy strong { color: #020617; }
          .copy .licence { margin-top: 1.8mm; font-size: 7pt; color: #475569; }
          .symbols { position: absolute; top: 19mm; left: 83mm; display: flex; align-items: center; gap: 3mm; }
          .non-sterile { position: relative; width: 12mm; height: 12mm; display: grid; place-items: center; background: #fff; color: #000; }
          .non-sterile:before { content: ""; position: absolute; inset: 1.8mm; border: 1px solid #111; transform: rotate(45deg); }
          .non-sterile span { position: relative; font-size: 5pt; font-weight: 800; text-align: center; line-height: 1; }
          .factory { width: 13mm; height: 12mm; display: flex; flex-direction: column; align-items: center; justify-content: center; border-radius: 3px; background: #020617; color: #fff; }
          .factory-bars { height: 5mm; display: flex; align-items: flex-end; gap: .8mm; margin-bottom: .6mm; }
          .factory-bars i { display: block; width: 2mm; background: #fff; }
          .factory-bars i:nth-child(1) { height: 3mm; }
          .factory-bars i:nth-child(2) { height: 5mm; }
          .factory-bars i:nth-child(3) { height: 2mm; }
          .factory span { font-size: 4.5pt; font-weight: 800; line-height: 1; }
          .mark { position: absolute; top: 15mm; right: 23mm; width: 10mm; height: 10mm; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 3px; background: #fff; }
          .mark-green { position: absolute; inset: 0 0 0 auto; width: 3.2mm; background: #8cc63f; }
          .mark-ring { position: absolute; left: 1.3mm; top: 1.3mm; width: 6.8mm; height: 6.8mm; border: 1.5mm solid #2d5aa3; border-radius: 999px; }
          .mark-dot { position: absolute; left: 4.4mm; top: 4mm; width: 3mm; height: 3mm; border-radius: 999px; background: #5d6a7a; }
          .maker-rail { position: absolute; right: 2.5mm; top: 11mm; display: flex; width: 17mm; height: 35mm; flex-direction: column; align-items: center; overflow: hidden; border: 1px solid #e2e8f0; border-right: 0; border-radius: 4px 0 0 4px; background: #f8fafc; padding: 1.2mm; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
          .maker-logo { width: 8.2mm; height: 8.2mm; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 2mm; background: #fff; position: relative; flex: 0 0 auto; }
          .maker-logo:before { content: ""; position: absolute; inset: 0 0 0 auto; width: 2.8mm; background: #8cc63f; }
          .maker-logo-mark { position: absolute; left: 1.1mm; top: 1.1mm; width: 5mm; height: 5mm; border: 1.2mm solid #3764b3; border-radius: 999px; }
          .maker-logo-mark:after { content: ""; position: absolute; left: 1.7mm; top: 1.7mm; width: 1.3mm; height: 1.3mm; border-radius: 999px; background: #5d6a7a; }
          .maker-name { margin-top: 1.8mm; color: #315ef2; font-family: Arial, Helvetica, sans-serif; font-size: 6.4pt; font-weight: 900; letter-spacing: .12em; writing-mode: vertical-rl; text-orientation: mixed; white-space: nowrap; line-height: 1; }
          .maker-address { margin-top: 1.2mm; color: #4f7df0; font-family: Arial, Helvetica, sans-serif; font-size: 4.8pt; font-weight: 700; letter-spacing: .05em; writing-mode: vertical-rl; text-orientation: mixed; white-space: pre-line; line-height: 1.05; }
          .brand-strip { position: absolute; left: 0; right: 0; bottom: 8mm; height: 10mm; display: flex; align-items: center; justify-content: space-around; border-top: 1px solid #7bb6ff; background: #2f6ff2; }
          .brand-strip span { position: relative; color: #dff6ff; font-size: 14pt; font-weight: 900; line-height: 1; letter-spacing: .26em; }
          .brand-strip sup { position: absolute; top: -2.5mm; right: -3.5mm; color: #fff; font-size: 5pt; }
          .mfg-date { position: absolute; bottom: 2mm; left: 50%; transform: translateX(-50%); color: #475569; font-size: 7pt; font-weight: 800; }
          .ref-link { position: absolute; left: 4mm; right: 4mm; bottom: 1.2mm; color: #64748b; font-size: 5.5pt; font-weight: 700; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .summary { width: 142mm; margin: 5mm auto 0; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; font-size: 9pt; font-weight: 700; }
          .summary .wide { grid-column: 1 / -1; }
          @page { size: A4 portrait; margin: 10mm; }
        </style>
      </head>
      <body>
        <main class="page">
          <div class="hospital">
            <h2>${escapeHtml(patient.hospitalName)}</h2>
            <p>${escapeHtml(patient.patientName)} | ${escapeHtml(patient.patientId)} | DOA ${escapeHtml(patient.admissionDate)}</p>
          </div>
          <div class="sheet">
            ${renderPrintLabel({
              implantName: surgeryName || defaultSurgeryName || details.secondaryImplantName,
              catNo: details.primaryCatNo,
              quantity: details.primaryQuantity,
              mrp: details.primaryMrp,
              batchNo: details.primaryBatchNo,
            })}
            ${renderPrintLabel({
              implantName: details.secondaryImplantName,
              catNo: details.secondaryCatNo,
              quantity: details.secondaryQuantity,
              mrp: details.secondaryMrp,
              batchNo: details.secondaryBatchNo,
            })}
          </div>
          <div class="summary">
            <div>Batch Numbers: ${escapeHtml(batchNumbers)}</div>
            <div>Date of surgery: ${escapeHtml(surgeryDateLabel)}</div>
            <div class="wide">Name of Implant: ${escapeHtml(surgeryName)}</div>
            <div class="wide">Reference Link: ${escapeHtml(details.referenceLink)}</div>
          </div>
        </main>
      </body>
    </html>
  `;

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
    if (!printWindow) return;
    printWindow.document.write(renderPrintHtml());
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading implant sticker...</div>;
  }

  return (
    <div className="w-full max-w-full shrink-0 bg-white shadow-lg print:hidden">
      <div className="p-3 sm:p-4 md:p-6" style={{ fontFamily: 'Arial, sans-serif' }}>
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

        <div className="bg-white p-3 text-black sm:p-4">
          <div className="mb-3 text-center">
            <h2 className="text-lg font-bold tracking-wide">{patient.hospitalName}</h2>
            <div className="text-xs font-semibold">{patient.patientName} | {patient.patientId} | DOA {patient.admissionDate}</div>
          </div>

          <div className="mx-auto max-w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-3 shadow-sm sm:px-4 sm:py-5 md:w-[560px] md:px-8">
            <div className="md:hidden">
              <div className="mx-auto h-[152px] w-[310px] origin-top scale-[0.68] overflow-hidden">
                <ImplantLabelBlock
                  details={details}
                  implantName={surgeryName || defaultSurgeryName || details.secondaryImplantName}
                  catNo={details.primaryCatNo}
                  quantity={details.primaryQuantity}
                  mrp={details.primaryMrp}
                  batchNo={details.primaryBatchNo}
                />
              </div>
              <div className="-mt-5" />
              <div className="mx-auto h-[152px] w-[310px] origin-top scale-[0.68] overflow-hidden">
                <ImplantLabelBlock
                  details={details}
                  implantName={details.secondaryImplantName}
                  catNo={details.secondaryCatNo}
                  quantity={details.secondaryQuantity}
                  mrp={details.secondaryMrp}
                  batchNo={details.secondaryBatchNo}
                />
              </div>
            </div>
            <div className="hidden md:block">
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
          </div>

          <div className="mx-auto mt-4 grid max-w-full gap-x-6 gap-y-1 text-xs md:w-[520px] md:grid-cols-2">
            <div><strong>Batch Numbers:</strong> {batchNumbers}</div>
            <div><strong>Date of surgery:</strong> {surgeryDateLabel}</div>
            <div className="col-span-2"><strong>Name of Implant:</strong> {surgeryName}</div>
            <div className="col-span-2 break-all"><strong>Reference Link:</strong> {details.referenceLink}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
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
          <TextareaField label="Address" value={details.manufacturerAddress} onChange={(value) => updateDetail('manufacturerAddress', value)} rows={5} />
          <LinkField
            label="Reference Link"
            value={details.referenceLink}
            onChange={(value) => updateDetail('referenceLink', value)}
            onCopy={handleCopyReferenceLink}
          />
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
