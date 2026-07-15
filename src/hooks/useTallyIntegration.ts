import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { tallyIntegration } from '@/services/tallyIntegration';
import {
  TallyConfig,
  TallySyncStatus,
  TallyImportRequest,
  TallyImportResult,
  TallyExportRequest,
  TallyVoucher,
  TallyLedger
} from '@/types/tally';

export function useTallyConfig() {
  return useQuery({
    queryKey: ['tally-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tally_config')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      return data as TallyConfig;
    }
  });
}

export function useSaveTallyConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: TallyConfig) => {
      const { data, error } = await supabase
        .from('tally_config')
        .upsert({
          company_name: config.companyName,
          tally_server_url: config.tallyServerUrl,
          tally_port: config.tallyPort,
          company_guid: config.companyGuid,
          mapping_rules: config.mappingRules
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tally-config'] });
      toast.success('Tally configuration saved successfully');
    },
    onError: (error) => {
      toast.error('Failed to save Tally configuration');
      console.error('Save config error:', error);
    }
  });
}

export function useTallySyncStatus() {
  return useQuery({
    queryKey: ['tally-sync-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tally_sync_status')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as TallySyncStatus[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
}

export function useSyncWithTally() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);

  return useMutation({
    mutationFn: async (syncType: 'ledgers' | 'vouchers' | 'full') => {
      const config = await queryClient.fetchQuery({
        queryKey: ['tally-config']
      }) as TallyConfig;

      if (!config) {
        throw new Error('Tally configuration not found');
      }

      await tallyIntegration.initialize(config.id!);

      switch (syncType) {
        case 'ledgers':
          return tallyIntegration.syncLedgers();
        case 'vouchers':
          // Implement voucher sync
          throw new Error('Voucher sync not implemented yet');
        case 'full':
          // Implement full sync
          throw new Error('Full sync not implemented yet');
        default:
          throw new Error('Invalid sync type');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tally-sync-status'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success('Sync completed successfully');
      setProgress(0);
    },
    onError: (error) => {
      toast.error('Sync failed: ' + (error as Error).message);
      setProgress(0);
    }
  });
}

export function useImportFromTally() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: TallyImportRequest): Promise<TallyImportResult> => {
      const config = await queryClient.fetchQuery({
        queryKey: ['tally-config']
      }) as TallyConfig;

      if (!config) {
        throw new Error('Tally configuration not found');
      }

      // Parse the file content based on format
      let data: any;
      try {
        if (request.format === 'json') {
          data = JSON.parse(request.fileContent);
        } else if (request.format === 'xml') {
          // Parse XML content
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(request.fileContent, 'text/xml');
          // Convert XML to object structure
          data = xmlToObject(xmlDoc.documentElement);
        }
      } catch (error) {
        throw new Error('Failed to parse file content');
      }

      // Process the data based on import type
      const result: TallyImportResult = {
        success: false,
        recordsImported: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        errors: [],
        warnings: []
      };

      try {
        switch (request.importType) {
          case 'ledgers':
            result.recordsImported = await importLedgers(data, request.updateExisting);
            break;
          case 'vouchers':
            result.recordsImported = await importVouchers(data, request.updateExisting);
            break;
          case 'masters':
            result.recordsImported = await importMasters(data, request.updateExisting);
            break;
        }
        result.success = true;
      } catch (error) {
        result.errors.push({
          recordNumber: 0,
          recordIdentifier: 'global',
          errorCode: 'IMPORT_FAILED',
          errorMessage: (error as Error).message
        });
      }

      return result;
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Import completed: ${result.recordsImported} records imported`);
        queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
        queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      } else {
        toast.error('Import failed with errors');
      }
    },
    onError: (error) => {
      toast.error('Import failed: ' + (error as Error).message);
    }
  });
}

export function useExportToTally() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: TallyExportRequest): Promise<Blob> => {
      const config = await queryClient.fetchQuery({
        queryKey: ['tally-config']
      }) as TallyConfig;

      if (!config) {
        throw new Error('Tally configuration not found');
      }

      await tallyIntegration.initialize(config.id!);
      return tallyIntegration.exportData(request);
    },
    onSuccess: (data, variables) => {
      // Download the file
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tally_export_${variables.exportType}_${new Date().toISOString()}.${variables.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Export completed successfully');
    },
    onError: (error) => {
      toast.error('Export failed: ' + (error as Error).message);
    }
  });
}

export function useTestTallyConnection() {
  return useMutation({
    mutationFn: async (config: TallyConfig) => {
      await tallyIntegration.initialize(config.id || 'test');
      const companyInfo = await tallyIntegration.getCompanyInfo();
      return companyInfo;
    },
    onSuccess: (data) => {
      toast.success(`Connected to Tally: ${data.name}`);
    },
    onError: (error) => {
      toast.error('Failed to connect to Tally: ' + (error as Error).message);
    }
  });
}

// Helper functions
function xmlToObject(node: Element): any {
  const obj: any = {};
  
  if (node.hasChildNodes()) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i];
      
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childElement = child as Element;
        const childName = childElement.nodeName;
        
        if (childElement.childNodes.length === 1 && 
            childElement.childNodes[0].nodeType === Node.TEXT_NODE) {
          obj[childName] = childElement.textContent;
        } else {
          if (obj[childName]) {
            if (!Array.isArray(obj[childName])) {
              obj[childName] = [obj[childName]];
            }
            obj[childName].push(xmlToObject(childElement));
          } else {
            obj[childName] = xmlToObject(childElement);
          }
        }
      }
    }
  }
  
  return obj;
}

async function importLedgers(data: any, updateExisting: boolean): Promise<number> {
  const ledgers = Array.isArray(data) ? data : data.ledgers || [];
  let imported = 0;

  for (const ledger of ledgers) {
    try {
      const { error } = await supabase
        .from('chart_of_accounts')
        .upsert({
          name: ledger.name,
          account_type: ledger.accountType || 'asset',
          gl_code: ledger.glCode || generateGLCode(ledger.name),
          opening_balance: ledger.openingBalance || 0,
          tally_guid: ledger.guid,
          tally_parent: ledger.parent
        }, {
          onConflict: updateExisting ? 'tally_guid' : undefined
        });

      if (!error) imported++;
    } catch (error) {
      console.error('Failed to import ledger:', ledger.name, error);
    }
  }

  return imported;
}

async function importVouchers(data: any, updateExisting: boolean): Promise<number> {
  const vouchers = Array.isArray(data) ? data : data.vouchers || [];
  let imported = 0;

  for (const voucher of vouchers) {
    try {
      // Create voucher
      const { data: voucherData, error: voucherError } = await supabase
        .from('vouchers')
        .insert({
          voucher_type: voucher.voucherType,
          voucher_number: voucher.voucherNumber,
          date: voucher.date,
          narration: voucher.narration,
          reference_number: voucher.reference,
          tally_guid: voucher.guid
        })
        .select()
        .single();

      if (voucherError) throw voucherError;

      // Create voucher entries
      const entries = voucher.entries.map((entry: any) => ({
        voucher_id: voucherData.id,
        account_id: entry.accountId, // This needs to be resolved from ledger name
        debit_amount: entry.isDebit ? entry.amount : 0,
        credit_amount: !entry.isDebit ? entry.amount : 0,
        narration: entry.narration
      }));

      const { error: entriesError } = await supabase
        .from('voucher_entries')
        .insert(entries);

      if (!entriesError) imported++;
    } catch (error) {
      console.error('Failed to import voucher:', voucher.voucherNumber, error);
    }
  }

  return imported;
}

async function importMasters(data: any, updateExisting: boolean): Promise<number> {
  // Import various master data like cost centers, stock groups, etc.
  let imported = 0;
  
  // Import cost centers if present
  if (data.costCenters) {
    for (const costCenter of data.costCenters) {
      try {
        const { error } = await supabase
          .from('cost_centers')
          .upsert({
            name: costCenter.name,
            parent: costCenter.parent,
            tally_guid: costCenter.guid
          }, {
            onConflict: updateExisting ? 'tally_guid' : undefined
          });

        if (!error) imported++;
      } catch (error) {
        console.error('Failed to import cost center:', costCenter.name, error);
      }
    }
  }

  return imported;
}

function generateGLCode(name: string): string {
  // Simple GL code generation
  const hash = name.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  
  return Math.abs(hash).toString().slice(0, 6).padStart(6, '0');
}

export function useTallyWebSocket() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const queryClient = useQueryClient();

  const connect = (tallyServerUrl: string, port: number) => {
    if (socket) {
      socket.close();
    }

    setConnectionStatus('connecting');
    const ws = new WebSocket(`ws://${tallyServerUrl}:${port + 1}`); // Assume WebSocket port is +1

    ws.onopen = () => {
      setConnectionStatus('connected');
      toast.success('Connected to Tally WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleTallyMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      setConnectionStatus('disconnected');
      setSocket(null);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('disconnected');
      toast.error('WebSocket connection failed');
    };

    setSocket(ws);
  };

  const handleTallyMessage = (data: any) => {
    switch (data.type) {
      case 'voucher_created':
      case 'voucher_updated':
      case 'voucher_deleted':
        queryClient.invalidateQueries({ queryKey: ['vouchers'] });
        toast.info(`Voucher ${data.type.split('_')[1]}: ${data.voucherNumber}`);
        break;
      case 'ledger_created':
      case 'ledger_updated':
      case 'ledger_deleted':
        queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
        toast.info(`Ledger ${data.type.split('_')[1]}: ${data.ledgerName}`);
        break;
      default:
    }
  };

  const disconnect = () => {
    if (socket) {
      socket.close();
    }
  };

  return {
    connectionStatus,
    connect,
    disconnect
  };
}
