// @ts-nocheck
export interface TallyConfig {
  id?: string;
  companyName: string;
  tallyServerUrl: string;
  tallyPort: number;
  companyGuid?: string;
  lastSyncTime?: Date;
  mappingRules?: TallyMappingRules;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TallyMappingRules {
  ledgerMappings: Record<string, string>;
  voucherTypeMappings: Record<string, string>;
  costCenterMappings: Record<string, string>;
  stockGroupMappings: Record<string, string>;
}

export interface TallySyncStatus {
  id: string;
  syncType: 'ledgers' | 'vouchers' | 'masters' | 'full';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  recordsProcessed: number;
  recordsFailed: number;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

export interface TallyLedger {
  name: string;
  parent: string;
  address?: string;
  country?: string;
  state?: string;
  pincode?: string;
  email?: string;
  phone?: string;
  gstin?: string;
  panNumber?: string;
  openingBalance?: number;
  creditPeriod?: number;
  creditLimit?: number;
  guid?: string;
  alteredOn?: Date;
}

export interface TallyVoucher {
  voucherType: string;
  voucherNumber: string;
  date: Date;
  narration?: string;
  reference?: string;
  guid?: string;
  entries: TallyVoucherEntry[];
  costCenterAllocations?: TallyCostCenterAllocation[];
}

export interface TallyVoucherEntry {
  ledgerName: string;
  amount: number;
  isDebit: boolean;
  billAllocations?: TallyBillAllocation[];
}

export interface TallyBillAllocation {
  billName: string;
  billType: string;
  amount: number;
}

export interface TallyCostCenterAllocation {
  costCenterName: string;
  amount: number;
}

export interface TallyExportRequest {
  exportType: 'ledgers' | 'vouchers' | 'trial_balance' | 'profit_loss' | 'balance_sheet';
  fromDate?: Date;
  toDate?: Date;
  format: 'xml' | 'json' | 'excel';
  filters?: {
    ledgerGroups?: string[];
    voucherTypes?: string[];
    costCenters?: string[];
  };
}

export interface TallyImportRequest {
  importType: 'ledgers' | 'vouchers' | 'masters';
  fileContent: string;
  format: 'xml' | 'json';
  updateExisting: boolean;
  validateOnly: boolean;
}

export interface TallyImportResult {
  success: boolean;
  recordsImported: number;
  recordsUpdated: number;
  recordsFailed: number;
  errors: TallyImportError[];
  warnings: string[];
}

export interface TallyImportError {
  recordNumber: number;
  recordIdentifier: string;
  errorCode: string;
  errorMessage: string;
  fieldErrors?: Record<string, string>;
}

export interface TallyReport {
  reportType: string;
  fromDate: Date;
  toDate: Date;
  data: Record<string, unknown>;
  generatedAt: Date;
}

export interface TallyCostCenter {
  name: string;
  parent?: string;
  category?: string;
  guid?: string;
}

export interface TallyStockGroup {
  name: string;
  parent?: string;
  guid?: string;
}

export interface TallyStockItem {
  name: string;
  group: string;
  unit: string;
  openingStock?: number;
  openingRate?: number;
  gstRate?: number;
  hsnCode?: string;
  guid?: string;
}

export interface TallyCompany {
  name: string;
  mailingName: string;
  address: string;
  country: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  gstin: string;
  panNumber: string;
  guid: string;
  booksFrom: Date;
  lastVoucherDate: Date;
}

export interface TallyXMLRequest {
  envelope: {
    header: {
      version: string;
      tallyRequest: string;
    };
    body: {
      desc: {
        staticVariables: Record<string, unknown>;
        tdl?: {
          tdlMessage: Record<string, unknown>;
        };
      };
      data?: {
        msg: Record<string, unknown>;
      };
    };
  };
}

export interface TallyXMLResponse {
  envelope: {
    header: {
      version: string;
      status: number;
    };
    body: {
      desc?: Record<string, unknown>;
      data?: Record<string, unknown>;
      error?: {
        code: string;
        message: string;
      };
    };
  };
}
