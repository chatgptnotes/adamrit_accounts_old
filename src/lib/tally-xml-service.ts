// TallyPrime Server XML-over-HTTP API Service
// Handles all XML communication with TallyPrime Server via API proxy routes

export interface TallyLedgerData {
  name: string;
  parentGroup: string;
  openingBalance: number;
  closingBalance: number;
  address?: string;
  phone?: string;
  email?: string;
  gstNumber?: string;
  panNumber?: string;
  guid?: string;
}

export interface TallyGroupData {
  name: string;
  parentGroup: string;
  isRevenue: boolean;
  isDeemedPositive: boolean;
  natureOfGroup: string;
}

export interface TallyCostCentreData {
  name: string;
  parent?: string;
  category?: string;
}

export interface TallyStockItemData {
  name: string;
  stockGroup: string;
  unit: string;
  openingBalance: number;
  closingBalance: number;
  openingValue: number;
  closingValue: number;
  rate: number;
  gstRate: number;
  hsnCode?: string;
  guid?: string;
}

export interface TallyVoucherData {
  voucherNumber: string;
  voucherType: string;
  date: string;
  partyLedger: string;
  amount: number;
  narration: string;
  isCancelled: boolean;
  guid?: string;
  ledgerEntries: {
    ledgerName: string;
    amount: number;
    isDebit: boolean;
  }[];
}

export interface TrialBalanceEntry {
  ledgerName: string;
  debit: number;
  credit: number;
  closingBalance: number;
  group: string;
}

export interface BalanceSheetData {
  assets: { name: string; amount: number; children?: { name: string; amount: number }[] }[];
  liabilities: { name: string; amount: number; children?: { name: string; amount: number }[] }[];
  totalAssets: number;
  totalLiabilities: number;
}

export interface PnLData {
  income: { name: string; amount: number; children?: { name: string; amount: number }[] }[];
  expenses: { name: string; amount: number; children?: { name: string; amount: number }[] }[];
  grossProfit: number;
  netProfit: number;
  totalIncome: number;
  totalExpenses: number;
}

export interface OutstandingEntry {
  partyName: string;
  totalAmount: number;
  billDetails: { billNumber: string; date: string; amount: number; dueDate?: string; pending: number }[];
  aging: { current: number; days30: number; days60: number; days90: number; above90: number };
}

export interface CompanyInfo {
  name: string;
  mailingName: string;
  address: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  financialYearFrom: string;
  financialYearTo: string;
  booksFrom: string;
}

export interface CashBankBalance {
  ledgerName: string;
  group: string;
  balance: number;
}

export interface CreateLedgerPayload {
  name: string;
  parent: string;
  openingBalance?: number;
  address?: string;
  phone?: string;
  email?: string;
  gstNumber?: string;
  panNumber?: string;
}

export interface CreateVoucherPayload {
  voucherType: string;
  date: string;
  narration: string;
  partyLedger: string;
  ledgerEntries: {
    ledgerName: string;
    amount: number;
    isDeemedPositive: boolean;
  }[];
}

export interface AdamritBill {
  billId: string;
  billNumber: string;
  patientName: string;
  date: string;
  totalAmount: number;
  items: { description: string; ledgerName: string; amount: number }[];
}

export interface AdamritPayment {
  paymentId: string;
  receiptNumber: string;
  patientName: string;
  date: string;
  amount: number;
  paymentMode: string;
  bankLedger?: string;
}

export interface JournalEntry {
  date: string;
  narration: string;
  entries: { ledgerName: string; amount: number; isDebit: boolean }[];
}

export interface TallyResponse {
  success: boolean;
  message: string;
  created?: number;
  altered?: number;
  errors?: string[];
}

// Format date as YYYYMMDD for Tally
function formatTallyDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

// Build XML export request
function buildExportRequest(reportId: string, companyName: string, staticVars?: Record<string, string>): string {
  let varsXml = `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>\n        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`;

  if (staticVars) {
    for (const [key, value] of Object.entries(staticVars)) {
      varsXml += `\n        <${key}>${escapeXml(value)}</${key}>`;
    }
  }

  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${escapeXml(reportId)}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${varsXml}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Build XML import request
function buildImportRequest(companyName: string, dataXml: string): string {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        ${dataXml}
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function buildVoucherImportRequest(companyName: string, dataXml: string): string {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        ${dataXml}
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Parse simple XML text node value
function getXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

// Parse multiple XML elements
function getXmlElements(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  const matches = xml.match(regex);
  return matches || [];
}

// Get inner content of XML tag
function getXmlInner(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

// Get attribute value
function getXmlAttr(xml: string, attr: string): string {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : '';
}

// Send XML request via our API proxy
async function sendRequest(serverUrl: string, xmlBody: string): Promise<string> {
  const response = await fetch('/api/tally-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'proxy', serverUrl, xmlBody }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.response;
}

// Parse import response
function parseImportResponse(xml: string): TallyResponse {
  const created = parseInt(getXmlValue(xml, 'CREATED') || '0', 10);
  const altered = parseInt(getXmlValue(xml, 'ALTERED') || '0', 10);
  const errors: string[] = [];

  const errorElements = getXmlElements(xml, 'LINEERROR');
  for (const errEl of errorElements) {
    errors.push(getXmlInner(errEl, 'LINEERROR'));
  }

  const lastedError = getXmlValue(xml, 'LASTMSG');
  if (lastedError && lastedError.toLowerCase().includes('error')) {
    errors.push(lastedError);
  }

  return {
    success: errors.length === 0 && (created > 0 || altered > 0),
    message: errors.length > 0 ? errors.join('; ') : `Created: ${created}, Altered: ${altered}`,
    created,
    altered,
    errors: errors.length > 0 ? errors : undefined,
  };
}


// ============ EXPORT FUNCTIONS (Read from Tally) ============

export async function testConnection(serverUrl: string, companyName: string): Promise<{ connected: boolean; companies: string[]; version: string }> {
  try {
    const xml = buildExportRequest('List of Companies', companyName);
    const response = await sendRequest(serverUrl, xml);

    const companies: string[] = [];
    const companyElements = getXmlElements(response, 'COMPANY');
    for (const el of companyElements) {
      const name = getXmlValue(el, 'NAME') || getXmlInner(el, 'COMPANY');
      if (name) companies.push(name);
    }

    // Also try to parse from SVCURRENTCOMPANY or NAME tags
    if (companies.length === 0) {
      const nameElements = getXmlElements(response, 'NAME');
      for (const el of nameElements) {
        const name = getXmlInner(el, 'NAME');
        if (name) companies.push(name);
      }
    }

    const version = getXmlValue(response, 'VERSION') || 'Unknown';

    return { connected: true, companies, version };
  } catch (error) {
    return { connected: false, companies: [], version: '' };
  }
}

export async function getLedgers(serverUrl: string, companyName: string): Promise<TallyLedgerData[]> {
  const xml = buildExportRequest('List of Ledgers', companyName);
  const response = await sendRequest(serverUrl, xml);

  const ledgers: TallyLedgerData[] = [];
  const ledgerElements = getXmlElements(response, 'LEDGER');

  for (const el of ledgerElements) {
    ledgers.push({
      name: getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME'),
      parentGroup: getXmlValue(el, 'PARENT'),
      openingBalance: parseFloat(getXmlValue(el, 'OPENINGBALANCE') || '0'),
      closingBalance: parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || '0'),
      address: getXmlValue(el, 'ADDRESS'),
      phone: getXmlValue(el, 'LEDGERPHONE') || getXmlValue(el, 'PHONE'),
      email: getXmlValue(el, 'EMAIL') || getXmlValue(el, 'LEDGEREMAIL'),
      gstNumber: getXmlValue(el, 'PARTYGSTIN') || getXmlValue(el, 'GSTREGISTRATIONNUMBER'),
      panNumber: getXmlValue(el, 'INCOMETAXNUMBER') || getXmlValue(el, 'PANNUMBER'),
      guid: getXmlValue(el, 'GUID') || getXmlAttr(el, 'GUID'),
    });
  }

  return ledgers;
}

export async function getGroups(serverUrl: string, companyName: string): Promise<TallyGroupData[]> {
  const xml = buildExportRequest('List of Groups', companyName);
  const response = await sendRequest(serverUrl, xml);

  const groups: TallyGroupData[] = [];
  const groupElements = getXmlElements(response, 'GROUP');

  for (const el of groupElements) {
    const nature = getXmlValue(el, 'NATUREOFGROUP') || '';
    groups.push({
      name: getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME'),
      parentGroup: getXmlValue(el, 'PARENT'),
      isRevenue: nature === 'Revenue' || nature === 'Income',
      isDeemedPositive: getXmlValue(el, 'ISDEEMEDPOSITIVE') === 'Yes',
      natureOfGroup: nature,
    });
  }

  return groups;
}

export async function getCostCentres(serverUrl: string, companyName: string): Promise<TallyCostCentreData[]> {
  const xml = buildExportRequest('List of Cost Centres', companyName);
  const response = await sendRequest(serverUrl, xml);

  const centres: TallyCostCentreData[] = [];
  const elements = getXmlElements(response, 'COSTCENTRE');

  for (const el of elements) {
    centres.push({
      name: getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME'),
      parent: getXmlValue(el, 'PARENT'),
      category: getXmlValue(el, 'CATEGORY'),
    });
  }

  return centres;
}

export async function getStockItems(serverUrl: string, companyName: string): Promise<TallyStockItemData[]> {
  const xml = buildExportRequest('List of Stock Items', companyName);
  const response = await sendRequest(serverUrl, xml);

  const items: TallyStockItemData[] = [];
  const elements = getXmlElements(response, 'STOCKITEM');

  for (const el of elements) {
    items.push({
      name: getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME'),
      stockGroup: getXmlValue(el, 'PARENT') || getXmlValue(el, 'STOCKGROUP'),
      unit: getXmlValue(el, 'BASEUNITS') || getXmlValue(el, 'UNIT'),
      openingBalance: parseFloat(getXmlValue(el, 'OPENINGBALANCE') || '0'),
      closingBalance: parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || '0'),
      openingValue: parseFloat(getXmlValue(el, 'OPENINGVALUE') || '0'),
      closingValue: parseFloat(getXmlValue(el, 'CLOSINGVALUE') || '0'),
      rate: parseFloat(getXmlValue(el, 'CLOSINGRATE') || getXmlValue(el, 'RATE') || '0'),
      gstRate: parseFloat(getXmlValue(el, 'GSTRATE') || '0'),
      hsnCode: getXmlValue(el, 'HSNCODE') || getXmlValue(el, 'HSNSACCODE'),
      guid: getXmlValue(el, 'GUID') || getXmlAttr(el, 'GUID'),
    });
  }

  return items;
}

export async function getDayBook(serverUrl: string, companyName: string, fromDate: string, toDate: string): Promise<TallyVoucherData[]> {
  const xml = buildExportRequest('Day Book', companyName, {
    SVFROMDATE: formatTallyDate(fromDate),
    SVTODATE: formatTallyDate(toDate),
  });
  const response = await sendRequest(serverUrl, xml);
  return parseVouchersFromXml(response);
}

export async function getVouchers(serverUrl: string, companyName: string, voucherType: string, fromDate: string, toDate: string): Promise<TallyVoucherData[]> {
  const xml = buildExportRequest('List of Vouchers', companyName, {
    SVFROMDATE: formatTallyDate(fromDate),
    SVTODATE: formatTallyDate(toDate),
    VOUCHERTYPENAME: voucherType,
  });
  const response = await sendRequest(serverUrl, xml);
  return parseVouchersFromXml(response);
}

function parseVouchersFromXml(xml: string): TallyVoucherData[] {
  const vouchers: TallyVoucherData[] = [];
  const elements = getXmlElements(xml, 'VOUCHER');

  for (const el of elements) {
    const rawDate = getXmlValue(el, 'DATE');
    const date = rawDate ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : '';

    const ledgerEntries: TallyVoucherData['ledgerEntries'] = [];
    const entryElements = getXmlElements(el, 'ALLLEDGERENTRIES.LIST');
    for (const entryEl of entryElements) {
      const amount = parseFloat(getXmlValue(entryEl, 'AMOUNT') || '0');
      ledgerEntries.push({
        ledgerName: getXmlValue(entryEl, 'LEDGERNAME'),
        amount: Math.abs(amount),
        isDebit: amount < 0,
      });
    }

    // Calculate total amount
    const totalAmount = ledgerEntries.reduce((sum, e) => e.isDebit ? sum + e.amount : sum, 0);

    vouchers.push({
      voucherNumber: getXmlValue(el, 'VOUCHERNUMBER'),
      voucherType: getXmlValue(el, 'VOUCHERTYPENAME') || getXmlAttr(el, 'VCHTYPE'),
      date,
      partyLedger: getXmlValue(el, 'PARTYLEDGERNAME'),
      amount: totalAmount,
      narration: getXmlValue(el, 'NARRATION'),
      isCancelled: getXmlValue(el, 'ISCANCELLED') === 'Yes',
      guid: getXmlValue(el, 'GUID') || getXmlAttr(el, 'REMOTEID'),
      ledgerEntries,
    });
  }

  return vouchers;
}

export async function getTrialBalance(serverUrl: string, companyName: string, date: string): Promise<TrialBalanceEntry[]> {
  const xml = buildExportRequest('Trial Balance', companyName, {
    SVTODATE: formatTallyDate(date),
  });
  const response = await sendRequest(serverUrl, xml);

  const entries: TrialBalanceEntry[] = [];
  const elements = getXmlElements(response, 'DSPACCNAME');
  const amountElements = getXmlElements(response, 'DSPCLDRAMT');
  const amountElements2 = getXmlElements(response, 'DSPCLDRCR');

  // Try a simpler approach - parse LEDGER elements from trial balance
  const ledgerElements = getXmlElements(response, 'LEDGER');
  for (const el of ledgerElements) {
    const closing = parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || '0');
    entries.push({
      ledgerName: getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME'),
      debit: closing < 0 ? Math.abs(closing) : 0,
      credit: closing > 0 ? closing : 0,
      closingBalance: closing,
      group: getXmlValue(el, 'PARENT') || '',
    });
  }

  return entries;
}

export async function getBalanceSheet(serverUrl: string, companyName: string, date: string): Promise<BalanceSheetData> {
  const xml = buildExportRequest('Balance Sheet', companyName, {
    SVTODATE: formatTallyDate(date),
  });
  const response = await sendRequest(serverUrl, xml);

  // Parse balance sheet data
  const data: BalanceSheetData = {
    assets: [],
    liabilities: [],
    totalAssets: 0,
    totalLiabilities: 0,
  };

  const groupElements = getXmlElements(response, 'GROUP');
  for (const el of groupElements) {
    const name = getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME');
    const amount = Math.abs(parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || '0'));
    const nature = getXmlValue(el, 'NATUREOFGROUP') || '';

    const children: { name: string; amount: number }[] = [];
    const ledgerEls = getXmlElements(el, 'LEDGER');
    for (const ledgerEl of ledgerEls) {
      children.push({
        name: getXmlValue(ledgerEl, 'NAME') || getXmlAttr(ledgerEl, 'NAME'),
        amount: Math.abs(parseFloat(getXmlValue(ledgerEl, 'CLOSINGBALANCE') || '0')),
      });
    }

    const entry = { name, amount, children: children.length > 0 ? children : undefined };

    if (nature === 'Assets' || nature === 'Asset') {
      data.assets.push(entry);
      data.totalAssets += amount;
    } else {
      data.liabilities.push(entry);
      data.totalLiabilities += amount;
    }
  }

  return data;
}

export async function getProfitAndLoss(serverUrl: string, companyName: string, fromDate: string, toDate: string): Promise<PnLData> {
  const xml = buildExportRequest('Profit and Loss A/c', companyName, {
    SVFROMDATE: formatTallyDate(fromDate),
    SVTODATE: formatTallyDate(toDate),
  });
  const response = await sendRequest(serverUrl, xml);

  const data: PnLData = {
    income: [],
    expenses: [],
    grossProfit: 0,
    netProfit: 0,
    totalIncome: 0,
    totalExpenses: 0,
  };

  const groupElements = getXmlElements(response, 'GROUP');
  for (const el of groupElements) {
    const name = getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME');
    const amount = Math.abs(parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || '0'));
    const nature = getXmlValue(el, 'NATUREOFGROUP') || '';

    const children: { name: string; amount: number }[] = [];
    const ledgerEls = getXmlElements(el, 'LEDGER');
    for (const ledgerEl of ledgerEls) {
      children.push({
        name: getXmlValue(ledgerEl, 'NAME') || getXmlAttr(ledgerEl, 'NAME'),
        amount: Math.abs(parseFloat(getXmlValue(ledgerEl, 'CLOSINGBALANCE') || '0')),
      });
    }

    const entry = { name, amount, children: children.length > 0 ? children : undefined };

    if (nature === 'Revenue' || nature === 'Income') {
      data.income.push(entry);
      data.totalIncome += amount;
    } else if (nature === 'Expenditure' || nature === 'Expenses') {
      data.expenses.push(entry);
      data.totalExpenses += amount;
    }
  }

  data.grossProfit = data.totalIncome - data.totalExpenses;
  data.netProfit = data.grossProfit;

  return data;
}

export async function getOutstandingReceivables(serverUrl: string, companyName: string): Promise<OutstandingEntry[]> {
  const xml = buildExportRequest('Outstanding Receivables', companyName);
  const response = await sendRequest(serverUrl, xml);
  return parseOutstandingFromXml(response);
}

export async function getOutstandingPayables(serverUrl: string, companyName: string): Promise<OutstandingEntry[]> {
  const xml = buildExportRequest('Outstanding Payables', companyName);
  const response = await sendRequest(serverUrl, xml);
  return parseOutstandingFromXml(response);
}

function parseOutstandingFromXml(xml: string): OutstandingEntry[] {
  const entries: OutstandingEntry[] = [];
  const ledgerElements = getXmlElements(xml, 'LEDGER');

  for (const el of ledgerElements) {
    const name = getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME');
    const totalAmount = Math.abs(parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || getXmlValue(el, 'AMOUNT') || '0'));

    const billDetails: OutstandingEntry['billDetails'] = [];
    const billElements = getXmlElements(el, 'BILL');
    for (const billEl of billElements) {
      billDetails.push({
        billNumber: getXmlValue(billEl, 'NAME') || getXmlValue(billEl, 'BILLREF'),
        date: getXmlValue(billEl, 'DATE') || '',
        amount: Math.abs(parseFloat(getXmlValue(billEl, 'OPENINGBALANCE') || '0')),
        dueDate: getXmlValue(billEl, 'DUEDATE') || undefined,
        pending: Math.abs(parseFloat(getXmlValue(billEl, 'CLOSINGBALANCE') || '0')),
      });
    }

    entries.push({
      partyName: name,
      totalAmount,
      billDetails,
      aging: { current: totalAmount, days30: 0, days60: 0, days90: 0, above90: 0 },
    });
  }

  return entries;
}

export async function getCompanyInfo(serverUrl: string, companyName: string): Promise<CompanyInfo> {
  const xml = buildExportRequest('List of Companies', companyName);
  const response = await sendRequest(serverUrl, xml);

  const companyEl = getXmlElements(response, 'COMPANY')[0] || response;
  const booksFrom = getXmlValue(companyEl, 'BOOKSFROM') || getXmlValue(companyEl, 'STARTINGFROM') || '';
  const fyFrom = booksFrom ? `${booksFrom.slice(0, 4)}-${booksFrom.slice(4, 6)}-${booksFrom.slice(6, 8)}` : '';

  return {
    name: getXmlValue(companyEl, 'NAME') || companyName,
    mailingName: getXmlValue(companyEl, 'MAILINGNAME') || getXmlValue(companyEl, 'BASICCOMPANYMAILINGNAME') || '',
    address: getXmlValue(companyEl, 'ADDRESS') || '',
    state: getXmlValue(companyEl, 'STATENAME') || '',
    pincode: getXmlValue(companyEl, 'PINCODE') || '',
    phone: getXmlValue(companyEl, 'PHONENUMBER') || '',
    email: getXmlValue(companyEl, 'EMAIL') || '',
    financialYearFrom: fyFrom,
    financialYearTo: '',
    booksFrom: fyFrom,
  };
}

export async function getCashBankBalances(serverUrl: string, companyName: string): Promise<CashBankBalance[]> {
  // Fetch ledgers under Cash-in-Hand and Bank Accounts groups
  const xml = buildExportRequest('List of Ledgers', companyName);
  const response = await sendRequest(serverUrl, xml);

  const balances: CashBankBalance[] = [];
  const ledgerElements = getXmlElements(response, 'LEDGER');

  for (const el of ledgerElements) {
    const parent = getXmlValue(el, 'PARENT') || '';
    const lowerParent = parent.toLowerCase();
    if (lowerParent.includes('cash') || lowerParent.includes('bank')) {
      balances.push({
        ledgerName: getXmlValue(el, 'NAME') || getXmlAttr(el, 'NAME'),
        group: parent,
        balance: Math.abs(parseFloat(getXmlValue(el, 'CLOSINGBALANCE') || '0')),
      });
    }
  }

  return balances;
}


// ============ IMPORT FUNCTIONS (Write to Tally) ============

export async function createLedger(serverUrl: string, companyName: string, ledger: CreateLedgerPayload): Promise<TallyResponse> {
  const addressXml = ledger.address ? `<ADDRESS.LIST><ADDRESS>${escapeXml(ledger.address)}</ADDRESS></ADDRESS.LIST>` : '';
  const phoneXml = ledger.phone ? `<LEDGERPHONE>${escapeXml(ledger.phone)}</LEDGERPHONE>` : '';
  const emailXml = ledger.email ? `<LEDGEREMAIL>${escapeXml(ledger.email)}</LEDGEREMAIL>` : '';
  const gstXml = ledger.gstNumber ? `<PARTYGSTIN>${escapeXml(ledger.gstNumber)}</PARTYGSTIN>` : '';
  const panXml = ledger.panNumber ? `<INCOMETAXNUMBER>${escapeXml(ledger.panNumber)}</INCOMETAXNUMBER>` : '';
  const obXml = ledger.openingBalance ? `<OPENINGBALANCE>${ledger.openingBalance}</OPENINGBALANCE>` : '';

  const dataXml = `<LEDGER NAME="${escapeXml(ledger.name)}" ACTION="Create">
          <NAME>${escapeXml(ledger.name)}</NAME>
          <PARENT>${escapeXml(ledger.parent)}</PARENT>
          ${obXml}
          ${addressXml}
          ${phoneXml}
          ${emailXml}
          ${gstXml}
          ${panXml}
        </LEDGER>`;

  const xmlBody = buildImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

export async function createVoucher(serverUrl: string, companyName: string, voucher: CreateVoucherPayload): Promise<TallyResponse> {
  let entriesXml = '';
  for (const entry of voucher.ledgerEntries) {
    const amount = entry.isDeemedPositive ? -Math.abs(entry.amount) : Math.abs(entry.amount);
    entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(entry.ledgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  const dataXml = `<VOUCHER VCHTYPE="${escapeXml(voucher.voucherType)}" ACTION="Create">
          <DATE>${formatTallyDate(voucher.date)}</DATE>
          <NARRATION>${escapeXml(voucher.narration)}</NARRATION>
          <VOUCHERTYPENAME>${escapeXml(voucher.voucherType)}</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(voucher.partyLedger)}</PARTYLEDGERNAME>${entriesXml}
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

export async function createSalesVoucher(serverUrl: string, companyName: string, bill: AdamritBill): Promise<TallyResponse> {
  let entriesXml = `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(bill.patientName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${bill.totalAmount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;

  for (const item of bill.items) {
    entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(item.ledgerName || 'Hospital Income')}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${item.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  const dataXml = `<VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${formatTallyDate(bill.date)}</DATE>
          <NARRATION>IPD Bill #${escapeXml(bill.billNumber)}</NARRATION>
          <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(bill.patientName)}</PARTYLEDGERNAME>${entriesXml}
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

export async function createReceiptVoucher(serverUrl: string, companyName: string, payment: AdamritPayment): Promise<TallyResponse> {
  const bankLedger = payment.bankLedger || (payment.paymentMode === 'Cash' ? 'Cash' : 'Bank Account');

  const dataXml = `<VOUCHER VCHTYPE="Receipt" ACTION="Create">
          <DATE>${formatTallyDate(payment.date)}</DATE>
          <NARRATION>Receipt #${escapeXml(payment.receiptNumber)} from ${escapeXml(payment.patientName)}</NARRATION>
          <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(payment.patientName)}</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(bankLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${payment.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(payment.patientName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${payment.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

export async function createJournalVoucher(serverUrl: string, companyName: string, journal: JournalEntry): Promise<TallyResponse> {
  let entriesXml = '';
  for (const entry of journal.entries) {
    const amount = entry.isDebit ? -Math.abs(entry.amount) : Math.abs(entry.amount);
    entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(entry.ledgerName)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${entry.isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  const dataXml = `<VOUCHER VCHTYPE="Journal" ACTION="Create">
          <DATE>${formatTallyDate(journal.date)}</DATE>
          <NARRATION>${escapeXml(journal.narration)}</NARRATION>
          <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>${entriesXml}
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

export async function createCostCentre(serverUrl: string, companyName: string, name: string, parent?: string): Promise<TallyResponse> {
  const dataXml = `<COSTCENTRE NAME="${escapeXml(name)}" ACTION="Create">
          <NAME>${escapeXml(name)}</NAME>
          ${parent ? `<PARENT>${escapeXml(parent)}</PARENT>` : ''}
        </COSTCENTRE>`;

  const xmlBody = buildImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 1: Payment Voucher ============
export async function createPaymentVoucher(serverUrl: string, companyName: string, payment: {
  date: string;
  partyLedger: string;
  amount: number;
  paymentMode: string;
  bankLedger?: string;
  narration?: string;
  billRef?: string;
}): Promise<TallyResponse> {
  const creditLedger = payment.bankLedger || (payment.paymentMode === 'Cash' ? 'Cash' : 'Bank Account');
  const billRefXml = payment.billRef ? `<BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(payment.billRef)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>${payment.amount}</AMOUNT>
            </BILLALLOCATIONS.LIST>` : '';

  const dataXml = `<VOUCHER VCHTYPE="Payment" ACTION="Create">
          <DATE>${formatTallyDate(payment.date)}</DATE>
          <NARRATION>${escapeXml(payment.narration || `Payment to ${payment.partyLedger}`)}</NARRATION>
          <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(payment.partyLedger)}</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(payment.partyLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${payment.amount}</AMOUNT>
            ${billRefXml}
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(creditLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${payment.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 2: Contra Voucher ============
export async function createContraVoucher(serverUrl: string, companyName: string, contra: {
  date: string;
  fromLedger: string;
  toLedger: string;
  amount: number;
  narration?: string;
}): Promise<TallyResponse> {
  const dataXml = `<VOUCHER VCHTYPE="Contra" ACTION="Create">
          <DATE>${formatTallyDate(contra.date)}</DATE>
          <NARRATION>${escapeXml(contra.narration || `Transfer from ${contra.fromLedger} to ${contra.toLedger}`)}</NARRATION>
          <VOUCHERTYPENAME>Contra</VOUCHERTYPENAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(contra.toLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${contra.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(contra.fromLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${contra.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 3: Purchase Voucher ============
export async function createPurchaseVoucher(serverUrl: string, companyName: string, purchase: {
  date: string;
  supplierLedger: string;
  purchaseLedger: string;
  items: Array<{ name: string; qty: number; rate: number; amount: number }>;
  totalAmount: number;
  narration?: string;
  invoiceNumber?: string;
}): Promise<TallyResponse> {
  let inventoryXml = '';
  for (const item of purchase.items) {
    inventoryXml += `
          <ALLINVENTORYENTRIES.LIST>
            <STOCKITEMNAME>${escapeXml(item.name)}</STOCKITEMNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <RATE>${item.rate}</RATE>
            <AMOUNT>-${item.amount}</AMOUNT>
            <ACTUALQTY>${item.qty}</ACTUALQTY>
            <BILLEDQTY>${item.qty}</BILLEDQTY>
          </ALLINVENTORYENTRIES.LIST>`;
  }

  const refXml = purchase.invoiceNumber ? `<REFERENCE>${escapeXml(purchase.invoiceNumber)}</REFERENCE>` : '';

  const dataXml = `<VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>${formatTallyDate(purchase.date)}</DATE>
          <NARRATION>${escapeXml(purchase.narration || `Purchase from ${purchase.supplierLedger}`)}</NARRATION>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(purchase.supplierLedger)}</PARTYLEDGERNAME>
          ${refXml}
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(purchase.supplierLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${purchase.totalAmount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(purchase.purchaseLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${purchase.totalAmount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>${inventoryXml}
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 4: Debit Note ============
export async function createDebitNote(serverUrl: string, companyName: string, note: {
  date: string;
  partyLedger: string;
  amount: number;
  reason: string;
  originalVoucherRef?: string;
}): Promise<TallyResponse> {
  const refXml = note.originalVoucherRef
    ? `<BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(note.originalVoucherRef)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>-${note.amount}</AMOUNT>
            </BILLALLOCATIONS.LIST>` : '';

  const dataXml = `<VOUCHER VCHTYPE="Debit Note" ACTION="Create">
          <DATE>${formatTallyDate(note.date)}</DATE>
          <NARRATION>${escapeXml(note.reason)}</NARRATION>
          <VOUCHERTYPENAME>Debit Note</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(note.partyLedger)}</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(note.partyLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${note.amount}</AMOUNT>
            ${refXml}
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Purchase Accounts</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${note.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 4: Credit Note ============
export async function createCreditNote(serverUrl: string, companyName: string, note: {
  date: string;
  partyLedger: string;
  amount: number;
  reason: string;
  originalVoucherRef?: string;
}): Promise<TallyResponse> {
  const refXml = note.originalVoucherRef
    ? `<BILLALLOCATIONS.LIST>
              <NAME>${escapeXml(note.originalVoucherRef)}</NAME>
              <BILLTYPE>Agst Ref</BILLTYPE>
              <AMOUNT>${note.amount}</AMOUNT>
            </BILLALLOCATIONS.LIST>` : '';

  const dataXml = `<VOUCHER VCHTYPE="Credit Note" ACTION="Create">
          <DATE>${formatTallyDate(note.date)}</DATE>
          <NARRATION>${escapeXml(note.reason)}</NARRATION>
          <VOUCHERTYPENAME>Credit Note</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(note.partyLedger)}</PARTYLEDGERNAME>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>Sales Accounts</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-${note.amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(note.partyLedger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
            <AMOUNT>${note.amount}</AMOUNT>
            ${refXml}
          </ALLLEDGERENTRIES.LIST>
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 8: Alter Voucher ============
export async function alterVoucher(serverUrl: string, companyName: string, voucher: {
  originalVoucherNumber: string;
  voucherType: string;
  date: string;
  partyLedger: string;
  amount: number;
  narration?: string;
  ledgerEntries: Array<{ ledger: string; amount: number; isDeemedPositive: boolean }>;
}): Promise<TallyResponse> {
  let entriesXml = '';
  for (const entry of voucher.ledgerEntries) {
    const amount = entry.isDeemedPositive ? -Math.abs(entry.amount) : Math.abs(entry.amount);
    entriesXml += `
          <ALLLEDGERENTRIES.LIST>
            <LEDGERNAME>${escapeXml(entry.ledger)}</LEDGERNAME>
            <ISDEEMEDPOSITIVE>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
            <AMOUNT>${amount}</AMOUNT>
          </ALLLEDGERENTRIES.LIST>`;
  }

  const dataXml = `<VOUCHER VCHTYPE="${escapeXml(voucher.voucherType)}" ACTION="Alter" VOUCHERNUMBER="${escapeXml(voucher.originalVoucherNumber)}">
          <VOUCHERNUMBER>${escapeXml(voucher.originalVoucherNumber)}</VOUCHERNUMBER>
          <DATE>${formatTallyDate(voucher.date)}</DATE>
          <NARRATION>${escapeXml(voucher.narration || '')}</NARRATION>
          <VOUCHERTYPENAME>${escapeXml(voucher.voucherType)}</VOUCHERTYPENAME>
          <PARTYLEDGERNAME>${escapeXml(voucher.partyLedger)}</PARTYLEDGERNAME>${entriesXml}
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 9: Cancel/Delete Voucher ============
export async function cancelVoucher(serverUrl: string, companyName: string, voucher: {
  voucherNumber: string;
  voucherType: string;
}): Promise<TallyResponse> {
  const dataXml = `<VOUCHER VCHTYPE="${escapeXml(voucher.voucherType)}" ACTION="Delete" VOUCHERNUMBER="${escapeXml(voucher.voucherNumber)}">
          <VOUCHERNUMBER>${escapeXml(voucher.voucherNumber)}</VOUCHERNUMBER>
          <VOUCHERTYPENAME>${escapeXml(voucher.voucherType)}</VOUCHERTYPENAME>
        </VOUCHER>`;

  const xmlBody = buildVoucherImportRequest(companyName, dataXml);
  const response = await sendRequest(serverUrl, xmlBody);
  return parseImportResponse(response);
}

// ============ ITEM 10: GST Data Sync ============
export interface GSTR1Data {
  b2b: Array<{ partyName: string; gstin: string; invoices: Array<{ number: string; date: string; value: number; taxableValue: number; igst: number; cgst: number; sgst: number }> }>;
  b2c: Array<{ invoiceNumber: string; date: string; value: number; taxableValue: number }>;
  hsnSummary: Array<{ hsnCode: string; description: string; qty: number; taxableValue: number; igst: number; cgst: number; sgst: number }>;
}

export interface GSTR3BData {
  outwardSupplies: { taxable: number; igst: number; cgst: number; sgst: number };
  inwardSupplies: { taxable: number; igst: number; cgst: number; sgst: number };
  itcAvailed: { igst: number; cgst: number; sgst: number };
  taxPayable: { igst: number; cgst: number; sgst: number };
}

export interface GSTLedgerEntry {
  date: string;
  voucherNumber: string;
  voucherType: string;
  partyName: string;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export async function getGSTR1Summary(serverUrl: string, companyName: string, fromDate: string, toDate: string): Promise<GSTR1Data> {
  const xml = buildExportRequest('GSTR-1', companyName, {
    SVFROMDATE: formatTallyDate(fromDate),
    SVTODATE: formatTallyDate(toDate),
  });

  try {
    const response = await sendRequest(serverUrl, xml);
    const b2b: GSTR1Data['b2b'] = [];
    const b2c: GSTR1Data['b2c'] = [];
    const hsnSummary: GSTR1Data['hsnSummary'] = [];

    const voucherElements = getXmlElements(response, 'VOUCHER');
    for (const el of voucherElements) {
      const partyName = getXmlValue(el, 'PARTYLEDGERNAME');
      const gstin = getXmlValue(el, 'PARTYGSTIN');
      const voucherNum = getXmlValue(el, 'VOUCHERNUMBER');
      const rawDate = getXmlValue(el, 'DATE');
      const date = rawDate ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : '';
      const amount = Math.abs(parseFloat(getXmlValue(el, 'AMOUNT') || '0'));

      if (gstin) {
        let party = b2b.find(p => p.gstin === gstin);
        if (!party) { party = { partyName, gstin, invoices: [] }; b2b.push(party); }
        party.invoices.push({ number: voucherNum, date, value: amount, taxableValue: amount, igst: 0, cgst: 0, sgst: 0 });
      } else {
        b2c.push({ invoiceNumber: voucherNum, date, value: amount, taxableValue: amount });
      }
    }

    return { b2b, b2c, hsnSummary };
  } catch {
    return { b2b: [], b2c: [], hsnSummary: [] };
  }
}

export async function getGSTR3BSummary(serverUrl: string, companyName: string, fromDate: string, toDate: string): Promise<GSTR3BData> {
  const xml = buildExportRequest('GSTR-3B', companyName, {
    SVFROMDATE: formatTallyDate(fromDate),
    SVTODATE: formatTallyDate(toDate),
  });

  try {
    const response = await sendRequest(serverUrl, xml);
    const data: GSTR3BData = {
      outwardSupplies: { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
      inwardSupplies: { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
      itcAvailed: { igst: 0, cgst: 0, sgst: 0 },
      taxPayable: { igst: 0, cgst: 0, sgst: 0 },
    };

    // Parse GST summary data from response
    data.outwardSupplies.taxable = Math.abs(parseFloat(getXmlValue(response, 'TAXABLEAMOUNT') || '0'));
    data.outwardSupplies.igst = Math.abs(parseFloat(getXmlValue(response, 'IGSTAMOUNT') || '0'));
    data.outwardSupplies.cgst = Math.abs(parseFloat(getXmlValue(response, 'CGSTAMOUNT') || '0'));
    data.outwardSupplies.sgst = Math.abs(parseFloat(getXmlValue(response, 'SGSTAMOUNT') || '0'));

    return data;
  } catch {
    return {
      outwardSupplies: { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
      inwardSupplies: { taxable: 0, igst: 0, cgst: 0, sgst: 0 },
      itcAvailed: { igst: 0, cgst: 0, sgst: 0 },
      taxPayable: { igst: 0, cgst: 0, sgst: 0 },
    };
  }
}

export async function getGSTLedger(serverUrl: string, companyName: string, fromDate: string, toDate: string): Promise<GSTLedgerEntry[]> {
  // Fetch vouchers and filter for GST-related entries
  const xml = buildExportRequest('Day Book', companyName, {
    SVFROMDATE: formatTallyDate(fromDate),
    SVTODATE: formatTallyDate(toDate),
  });

  try {
    const response = await sendRequest(serverUrl, xml);
    const entries: GSTLedgerEntry[] = [];
    const voucherElements = getXmlElements(response, 'VOUCHER');

    for (const el of voucherElements) {
      const ledgerEntries = getXmlElements(el, 'ALLLEDGERENTRIES.LIST');
      let hasGst = false;
      let igst = 0, cgst = 0, sgst = 0, taxableValue = 0;

      for (const le of ledgerEntries) {
        const name = (getXmlValue(le, 'LEDGERNAME') || '').toLowerCase();
        const amt = Math.abs(parseFloat(getXmlValue(le, 'AMOUNT') || '0'));
        if (name.includes('igst')) { igst += amt; hasGst = true; }
        else if (name.includes('cgst')) { cgst += amt; hasGst = true; }
        else if (name.includes('sgst')) { sgst += amt; hasGst = true; }
        else { taxableValue += amt; }
      }

      if (hasGst) {
        const rawDate = getXmlValue(el, 'DATE');
        entries.push({
          date: rawDate ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : '',
          voucherNumber: getXmlValue(el, 'VOUCHERNUMBER'),
          voucherType: getXmlValue(el, 'VOUCHERTYPENAME'),
          partyName: getXmlValue(el, 'PARTYLEDGERNAME'),
          taxableValue, igst, cgst, sgst,
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}
