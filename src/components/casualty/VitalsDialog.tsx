import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/activity-logger';

interface VitalsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visitId: string;
  patientName: string;
  initialBp?: string;
  initialPulse?: number;
  onSaved: () => void;
}

const VitalsDialog: React.FC<VitalsDialogProps> = ({
  open,
  onOpenChange,
  visitId,
  patientName,
  initialBp = '',
  initialPulse,
  onSaved,
}) => {
  const [bp, setBp] = useState(initialBp);
  const [pulse, setPulse] = useState(initialPulse?.toString() || '');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!bp && !pulse) {
      toast({ title: 'Please enter BP or Pulse', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('casualty_vitals').insert({
        visit_id: visitId,
        bp: bp || null,
        pulse: pulse ? parseInt(pulse) : null,
      });
      if (error) throw error;
      await logActivity('casualty_vitals_saved', { visit_id: visitId, patient_name: patientName, bp, pulse });
      toast({ title: 'Vitals saved successfully' });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error saving vitals', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Vitals — {patientName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Blood Pressure (e.g. 120/80)</Label>
            <Input
              placeholder="120/80"
              value={bp}
              onChange={(e) => setBp(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Pulse (bpm)</Label>
            <Input
              type="number"
              placeholder="72"
              value={pulse}
              onChange={(e) => setPulse(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default VitalsDialog;
