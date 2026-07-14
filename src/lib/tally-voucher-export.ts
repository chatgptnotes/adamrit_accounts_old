export type TallyVoucherExportEntry = {
  accountName: string | null | undefined
  debitAmount: number | string | null | undefined
  creditAmount: number | string | null | undefined
  entryOrder?: number | null
}

export type TallyVoucherExportRecord = {
  id: string
  voucherNumber: string | null | undefined
  voucherDate: string | null | undefined
  voucherCategory: string | null | undefined
  narration: string | null | undefined
  status: string | null | undefined
  entries: TallyVoucherExportEntry[]
}

const TALLY_VOUCHER_TYPES: Record<string, string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  CONTRA: 'Contra',
  JOURNAL: 'Journal',
  SALES: 'Sales',
  PURCHASE: 'Purchase',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
}

function escapeXml(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function tallyDate(value: string): string {
  return value.replace(/-/g, '')
}

function number(value: number | string | null | undefined): number {
  return Number(value || 0)
}

function partyLedger(category: string, entries: TallyVoucherExportEntry[]): string {
  if (category === 'JOURNAL' || category === 'CONTRA') return ''
  const partyEntry = category === 'RECEIPT'
    ? entries.find((entry) => number(entry.creditAmount) > 0)
    : entries.find((entry) => number(entry.debitAmount) > 0)
  return partyEntry?.accountName || ''
}

/**
 * Creates a native Tally voucher import document. All selected vouchers are
 * validated first, so callers never download a silently partial XML file.
 */
export function buildTallyVoucherImportXml(records: TallyVoucherExportRecord[]): string {
  if (!records.length) throw new Error('Select at least one Adamrit voucher to export')

  const messages = records.map((record) => {
    const category = (record.voucherCategory || '').toUpperCase()
    const voucherType = TALLY_VOUCHER_TYPES[category]
    const entries = [...(record.entries || [])].sort((a, b) => (a.entryOrder || 0) - (b.entryOrder || 0))
    const debitTotal = entries.reduce((sum, entry) => sum + number(entry.debitAmount), 0)
    const creditTotal = entries.reduce((sum, entry) => sum + number(entry.creditAmount), 0)

    if (record.status !== 'AUTHORISED') throw new Error(`${record.voucherNumber || record.id}: only authorised vouchers can be exported`)
    if (!voucherType) throw new Error(`${record.voucherNumber || record.id}: unsupported voucher type ${category || 'unknown'}`)
    if (!record.voucherDate || !/^\d{4}-\d{2}-\d{2}$/.test(record.voucherDate)) throw new Error(`${record.voucherNumber || record.id}: invalid voucher date`)
    if (!record.voucherNumber) throw new Error(`${record.id}: missing voucher number`)
    if (entries.length < 2 || entries.some((entry) => !entry.accountName || (number(entry.debitAmount) <= 0 && number(entry.creditAmount) <= 0))) {
      throw new Error(`${record.voucherNumber}: every voucher entry needs a Tally ledger and amount`)
    }
    if (debitTotal <= 0 || Math.abs(debitTotal - creditTotal) > 0.01) {
      throw new Error(`${record.voucherNumber}: debit and credit totals must balance before export`)
    }

    const entriesXml = entries.map((entry) => {
      const debit = number(entry.debitAmount)
      const credit = number(entry.creditAmount)
      const isDebit = debit > 0
      const amount = isDebit ? -debit : credit
      return `    <ALLLEDGERENTRIES.LIST>\n` +
        `     <LEDGERNAME>${escapeXml(entry.accountName)}</LEDGERNAME>\n` +
        `     <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>\n` +
        `     <AMOUNT>${amount.toFixed(2)}</AMOUNT>\n` +
        `    </ALLLEDGERENTRIES.LIST>`
    }).join('\n')
    const party = partyLedger(category, entries)

    return `  <TALLYMESSAGE xmlns:UDF="TallyUDF">\n` +
      `   <VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create">\n` +
      `    <DATE>${tallyDate(record.voucherDate)}</DATE>\n` +
      `    <EFFECTIVEDATE>${tallyDate(record.voucherDate)}</EFFECTIVEDATE>\n` +
      `    <VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>\n` +
      `    <VOUCHERNUMBER>${escapeXml(record.voucherNumber)}</VOUCHERNUMBER>\n` +
      `    <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n` +
      `    <ISINVOICE>No</ISINVOICE>\n` +
      (party ? `    <PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME>\n` : '') +
      `    <NARRATION>${escapeXml(record.narration)}</NARRATION>\n` +
      entriesXml + `\n` +
      `   </VOUCHER>\n` +
      `  </TALLYMESSAGE>`
  })

  return `<ENVELOPE>\n <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n <BODY>\n  <IMPORTDATA>\n` +
    `   <REQUESTDESC>\n    <REPORTNAME>Vouchers</REPORTNAME>\n   </REQUESTDESC>\n   <REQUESTDATA>\n` +
    messages.join('\n') +
    `\n   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n`
}

export function downloadTallyVoucherImport(filename: string, xml: string): void {
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
