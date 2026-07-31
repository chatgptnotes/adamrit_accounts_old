import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Search, RefreshCw } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Voucher numbers are stored as PREFIX + zero-padded-4-digit number, e.g. "REC0007".
// The prefix comes from the voucher_types table and has no separator character.

interface GapEntry {
  missing: number;
  expectedVoucher: string;
  between: {
    before: { voucher_number: string };
    after: { voucher_number: string };
  };
}

interface GapAnalysis {
  gaps: GapEntry[];
  total: number;
  firstNumber: number;
  lastNumber: number;
  expectedCount: number;
  missingCount: number;
}

const VOUCHER_PREFIXES = [
  { value: 'REC', label: 'REC — Receipt' },
  { value: 'PAY', label: 'PAY — Payment' },
  { value: 'JRN', label: 'JRN — Journal' },
  { value: 'CNT', label: 'CNT — Contra' },
];

// Pads the numeric suffix to 4 digits, matching generateVoucherNumber() in VoucherEntry.tsx.
const formatVoucherNumber = (prefix: string, num: number): string =>
  `${prefix}${String(num).padStart(4, '0')}`;

const VoucherGapDetection: React.FC = () => {
  const [voucherPrefix, setVoucherPrefix] = useState<string>('REC');

  const {
    data: gapAnalysis,
    isFetching,
    refetch,
  } = useQuery<GapAnalysis>({
    queryKey: ['voucher-gaps', voucherPrefix],
    queryFn: async (): Promise<GapAnalysis> => {
      // Fetch all vouchers whose number starts with the selected prefix.
      // Ordered by age, not by number: numbers come in two shapes (REC-012932 from
      // the old series, REC12933 from the current one) and '-' sorts before '0', so
      // ordering by the string put every new voucher past the row cap.
      const { data: vouchers, error } = await supabase
        .from('vouchers')
        .select('id, voucher_number, created_at')
        .ilike('voucher_number', `${voucherPrefix}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (!vouchers || vouchers.length === 0) {
        return { gaps: [], total: 0, firstNumber: 0, lastNumber: 0, expectedCount: 0, missingCount: 0 };
      }

      // Extract and sort the trailing numeric parts.
      type NumberedVoucher = { num: number; voucher: { voucher_number: string } };

      const numbered: NumberedVoucher[] = vouchers
        .map((v) => {
          const match = v.voucher_number?.match(/(\d+)$/);
          return match ? { num: parseInt(match[1], 10), voucher: v } : null;
        })
        .filter((x): x is NumberedVoucher => x !== null)
        .sort((a, b) => a.num - b.num);

      if (numbered.length === 0) {
        return { gaps: [], total: 0, firstNumber: 0, lastNumber: 0, expectedCount: 0, missingCount: 0 };
      }

      const gaps: GapEntry[] = [];

      for (let i = 1; i < numbered.length; i++) {
        const prev = numbered[i - 1];
        const curr = numbered[i];

        if (curr.num - prev.num > 1) {
          for (let missing = prev.num + 1; missing < curr.num; missing++) {
            gaps.push({
              missing,
              expectedVoucher: formatVoucherNumber(voucherPrefix, missing),
              between: {
                before: { voucher_number: prev.voucher.voucher_number },
                after:  { voucher_number: curr.voucher.voucher_number },
              },
            });
          }
        }
      }

      const first = numbered[0].num;
      const last  = numbered[numbered.length - 1].num;

      return {
        gaps,
        total: vouchers.length,
        firstNumber: first,
        lastNumber: last,
        expectedCount: last - first + 1,
        missingCount: gaps.length,
      };
    },
    // Only execute when the user clicks "Run Analysis".
    enabled: false,
  });

  const hasGaps = (gapAnalysis?.missingCount ?? 0) > 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Voucher Gap Detection
        </CardTitle>
      </CardHeader>

      <CardContent>
        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-end mb-6">
          <div>
            <label className="text-sm font-medium mb-1 block">Voucher Prefix</label>
            <Select value={voucherPrefix} onValueChange={setVoucherPrefix}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOUCHER_PREFIXES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Analysing…' : 'Run Analysis'}
          </Button>
        </div>

        {/* Results */}
        {gapAnalysis && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">{gapAnalysis.total}</p>
                  <p className="text-sm text-muted-foreground">Total Vouchers</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold">{gapAnalysis.expectedCount}</p>
                  <p className="text-sm text-muted-foreground">Expected Count</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className={`p-4 text-center ${hasGaps ? 'bg-red-50' : 'bg-green-50'}`}>
                  <p className={`text-2xl font-bold ${hasGaps ? 'text-red-600' : 'text-green-600'}`}>
                    {gapAnalysis.missingCount}
                  </p>
                  <p className="text-sm text-muted-foreground">Missing Vouchers</p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 flex items-center justify-center">
                  <Badge
                    variant={hasGaps ? 'destructive' : 'default'}
                    className="text-sm px-3 py-1"
                  >
                    {hasGaps ? 'Gaps Found' : 'No Gaps'}
                  </Badge>
                </CardContent>
              </Card>
            </div>

            {/* Gap table */}
            {gapAnalysis.gaps.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-red-600 mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Missing Voucher Numbers ({gapAnalysis.gaps.length})
                </h3>

                <div className="border rounded-lg overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-red-50 sticky top-0">
                      <tr>
                        <th className="p-2 text-left font-medium">#</th>
                        <th className="p-2 text-left font-medium">Missing Voucher</th>
                        <th className="p-2 text-left font-medium">Gap Between</th>
                        <th className="p-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gapAnalysis.gaps.map((gap, i) => (
                        <tr key={gap.expectedVoucher} className="border-t hover:bg-red-50/40">
                          <td className="p-2 text-muted-foreground">{i + 1}</td>
                          <td className="p-2 font-mono font-bold text-red-600">
                            {gap.expectedVoucher}
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">
                            {gap.between.before.voucher_number}
                            <span className="mx-1 text-gray-400">→</span>
                            {gap.between.after.voucher_number}
                          </td>
                          <td className="p-2">
                            <Badge variant="destructive" className="text-xs">Missing</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* All-clear message */}
            {gapAnalysis.gaps.length === 0 && gapAnalysis.total > 0 && (
              <div className="text-center py-8 bg-green-50 rounded-lg">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                <p className="text-lg font-semibold text-green-700">
                  All voucher numbers are sequential
                </p>
                <p className="text-sm text-green-600">
                  Range:{' '}
                  {formatVoucherNumber(voucherPrefix, gapAnalysis.firstNumber)}
                  {' '}to{' '}
                  {formatVoucherNumber(voucherPrefix, gapAnalysis.lastNumber)}
                </p>
              </div>
            )}

            {/* No vouchers found */}
            {gapAnalysis.total === 0 && (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <Search className="h-10 w-10 text-gray-400 mx-auto mb-2" />
                <p className="text-base font-medium text-gray-600">
                  No vouchers found with prefix <span className="font-mono">{voucherPrefix}</span>
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VoucherGapDetection;
