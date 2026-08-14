// ============================================================================
// Corporate Claim Import History Screen
// ============================================================================
// Shows all uploaded files with metadata, validation results, and duplicate status
// Allows tracking of all file imports and their outcomes
// ============================================================================

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Download, Eye } from 'lucide-react';
import { toast } from 'sonner';

interface ImportRecord {
  id: string;
  source_file_name: string;
  hospital_name: string;
  scheme_code: string;
  upload_date: string;
  content_hash: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_status: 'original' | 'duplicate' | 'renamed_duplicate';
  original_file_id?: string;
  uploaded_by?: string;
  validation_result?: {
    passed: boolean;
    errors: string[];
  };
}

export default function CorporateClaimImportHistory() {
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'original' | 'duplicate'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadImportHistory();
  }, []);

  const loadImportHistory = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('corporate_claim_snapshots')
        .select('*')
        .order('upload_date', { ascending: false })
        .limit(500);

      if (error) throw error;

      const processed = (data || []).map((row: any) => ({
        id: row.id,
        source_file_name: row.source_file_name,
        hospital_name: row.hospital_name,
        scheme_code: row.scheme_code,
        upload_date: row.upload_date || row.created_at,
        content_hash: row.content_hash,
        total_rows: row.total_rows || 0,
        valid_rows: row.valid_rows || 0,
        invalid_rows: row.invalid_rows || 0,
        duplicate_status: row.duplicate_status || 'original',
        original_file_id: row.original_file_id,
        uploaded_by: row.uploaded_by || 'Unknown'
      }));

      setRecords(processed);
    } catch (error) {
      console.error('Failed to load import history:', error);
      toast.error('Failed to load import history');
    } finally {
      setLoading(false);
    }
  };

  const filteredRecords = records.filter(record => {
    // Status filter
    if (filter === 'original' && record.duplicate_status !== 'original') return false;
    if (filter === 'duplicate' && record.duplicate_status === 'original') return false;

    // Search filter
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      return (
        record.source_file_name?.toLowerCase().includes(query) ||
        record.hospital_name?.toLowerCase().includes(query) ||
        record.scheme_code?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  const getStatusBadge = (record: ImportRecord) => {
    if (record.duplicate_status === 'duplicate') {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          Duplicate
        </Badge>
      );
    }
    if (record.duplicate_status === 'renamed_duplicate') {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Renamed Duplicate
        </Badge>
      );
    }
    if (record.invalid_rows > 0) {
      return (
        <Badge variant="outline" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Has Errors
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Valid
      </Badge>
    );
  };

  const viewSnapshotDetails = async (snapshotId: string) => {
    // In a real implementation, this would open a detail view or modal
    // showing the parsed data from this snapshot
    toast.info('Detail view coming soon');
  };

  const downloadOriginal = async (record: ImportRecord) => {
    // This would require implementing file storage and download
    toast.info('Download feature coming soon');
  };

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Import History</h1>
        <p className="text-muted-foreground">
          View all uploaded government portal files and their validation results
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Imports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{records.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Original Files</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">
              {records.filter(r => r.duplicate_status === 'original').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Duplicates Blocked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-700">
              {records.filter(r => r.duplicate_status !== 'original').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Rows Processed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {records.reduce((sum, r) => sum + r.total_rows, 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Card */}
      <Card>
        <CardHeader>
          <CardTitle>Upload History</CardTitle>
          <CardDescription>
            Track all file imports with validation results and duplicate detection
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <Input
                placeholder="Search by filename, hospital, or scheme..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Files</SelectItem>
                <SelectItem value="original">Original Only</SelectItem>
                <SelectItem value="duplicate">Duplicates Only</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={loadImportHistory} variant="outline">
              Refresh
            </Button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-10 text-muted-foreground">
              Loading import history...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              No import records found
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Hospital</TableHead>
                    <TableHead>Scheme</TableHead>
                    <TableHead>Upload Date</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Validation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Hash</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="h-4 w-4 text-green-600" />
                          {record.source_file_name}
                        </div>
                      </TableCell>
                      <TableCell>{record.hospital_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{record.scheme_code || '—'}</Badge>
                      </TableCell>
                      <TableCell>
                        {record.upload_date ? format(new Date(record.upload_date), 'dd-MMM-yyyy HH:mm') : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="text-xs">
                          <div>Total: {record.total_rows}</div>
                          <div className="text-green-600">Valid: {record.valid_rows}</div>
                          {record.invalid_rows > 0 && (
                            <div className="text-red-600">Invalid: {record.invalid_rows}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {record.invalid_rows === 0 ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-amber-600" />
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(record)}</TableCell>
                      <TableCell>
                        <code className="text-xs text-muted-foreground">
                          {record.content_hash?.slice(0, 8)}...
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => viewSnapshotDetails(record.id)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {record.duplicate_status === 'original' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => downloadOriginal(record)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Section */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">About Import Tracking</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="space-y-2">
            <li>• <strong>Content Hash</strong>: Each file is fingerprinted using SHA-256 to detect duplicates even if renamed</li>
            <li>• <strong>Duplicate Status</strong>: Duplicate files are blocked regardless of filename changes</li>
            <li>• <strong>Validation</strong>: Files are parsed and validated for required fields and data formats</li>
            <li>• <strong>Row Counts</strong>: Track total rows, valid rows, and invalid rows for each import</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
