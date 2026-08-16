
import { useState } from 'react';
import { useDiagnoses } from '@/hooks/useDiagnoses';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Stethoscope, BookMarked } from 'lucide-react';
import { AddDiagnosisDialog } from '@/components/AddDiagnosisDialog';
import { useSearchableIcd11, useIcd11MasterStatus } from '@/hooks/useSearchableIcd11';

const Diagnoses = () => {
  const { diagnoses, isLoading, addDiagnosis, isAddingDiagnosis } = useDiagnoses();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const icd11 = useSearchableIcd11();
  const icd11Status = useIcd11MasterStatus();

  const filteredDiagnoses = diagnoses.filter(diagnosis =>
    diagnosis.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (diagnosis.description && diagnosis.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleAddDiagnosis = (name: string, description?: string) => {
    addDiagnosis({ name, description });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-16 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading diagnoses...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-16 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Stethoscope className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold text-primary">
              Diagnoses Master List
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Manage all medical diagnosis categories
          </p>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search diagnoses..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Diagnosis
          </Button>
        </div>

        {/* ICD-11 lookup. Separate from the list above on purpose: these are the
            WHO's classification, not the hospital's diagnoses, and conflating
            the two would let someone pick a chapter heading as a diagnosis. */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookMarked className="h-4 w-4 text-primary" />
              ICD-11 lookup
              {icd11Status.data?.loaded && (
                <span className="text-xs font-normal text-muted-foreground">
                  {icd11Status.data.count.toLocaleString('en-IN')} entries
                  {icd11Status.data.release ? ` · release ${icd11Status.data.release}` : ''}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {icd11Status.data && !icd11Status.data.loaded ? (
              // An empty master must say it is empty. Otherwise every search
              // returns nothing and reads as "ICD-11 has no such diagnosis",
              // which is a clinical claim rather than a missing import.
              <p className="text-sm text-muted-foreground">
                The ICD-11 master has not been loaded yet. It is filled from the World Health
                Organization’s API — register at icd.who.int/icdapi, set ICD_API_CLIENT_ID and
                ICD_API_CLIENT_SECRET, then run the ICD-11 sync. Nothing here is invented locally.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search ICD-11 by code, title or clinical wording…"
                    value={icd11.searchTerm}
                    onChange={(event) => icd11.setSearchTerm(event.target.value)}
                  />
                </div>
                {icd11.isError ? (
                  <p className="mt-3 text-sm text-red-600">
                    Could not search ICD-11 — {(icd11.error as any)?.message || 'the lookup failed'}.
                    No results are shown rather than an empty list.
                  </p>
                ) : icd11.tooShort ? (
                  <p className="mt-3 text-sm text-muted-foreground">Keep typing…</p>
                ) : icd11.isLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">Searching…</p>
                ) : icd11.results.length > 0 ? (
                  <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                    {icd11.results.map((entry) => (
                      <li key={entry.id} className="rounded-md border px-3 py-2 text-sm">
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-xs text-primary">{entry.code || '—'}</span>
                          <span className="flex-1">{entry.title}</span>
                          {!entry.is_leaf && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {entry.class_kind || 'grouping'}
                            </span>
                          )}
                        </div>
                        {entry.definition && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{entry.definition}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : icd11.searchTerm.trim() ? (
                  <p className="mt-3 text-sm text-muted-foreground">No ICD-11 entry matches that.</p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredDiagnoses.map((diagnosis) => (
            <Card key={diagnosis.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2 text-lg">
                  <span>{diagnosis.name}</span>
                  {(diagnosis as any).icd11_code && (
                    <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">
                      {(diagnosis as any).icd11_code}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              {diagnosis.description && (
                <CardContent>
                  <p className="text-muted-foreground">{diagnosis.description}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {filteredDiagnoses.length === 0 && (
          <div className="text-center py-12">
            <Stethoscope className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              {searchTerm ? 'No diagnoses found matching your search.' : 'No diagnoses available.'}
            </p>
          </div>
        )}

        <AddDiagnosisDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAddDiagnosis={handleAddDiagnosis}
        />
      </div>
    </div>
  );
};

export default Diagnoses;
