import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MessageCircle, Loader2 } from 'lucide-react';
import { composeReportReadyMessage, openWhatsApp } from '@/lib/patient-whatsapp';

interface Props {
  patientName: string;
  mobile: string | null;
  testNames?: string[];
  visitId?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'lg';
}

// Sends a WhatsApp notification to the patient that their reports are ready.
// Uses the send-payment-alerts edge function via a new 'lab_report' alert_type.
export function WhatsAppReportButton({
  patientName,
  mobile,
  testNames = [],
  visitId,
  className,
  variant = 'outline',
  size = 'sm',
}: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!mobile) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      const testsStr = testNames.length > 0 ? testNames.slice(0, 5).join(', ') : 'recent tests';
      const message = composeReportReadyMessage(patientName, `lab report for ${testsStr}`);

      // Try the whatsapp edge function; fall back gracefully
      const { error } = await supabase.functions.invoke('send-whatsapp-report', {
        body: { mobile, patient_name: patientName, message, visit_id: visitId },
      });

      if (error) {
        // Edge function may not exist yet — open the chat pre-filled instead
        if (openWhatsApp(mobile, message)) {
          toast.success('Opened WhatsApp with pre-filled message');
        } else {
          toast.error('Patient mobile number is not usable for WhatsApp.');
          return;
        }
      } else {
        toast.success(`Report notification sent to ${mobile}`);
      }
      setSent(true);
    } catch {
      toast.error('Could not send WhatsApp notification');
    } finally {
      setSending(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      className={`text-green-700 border-green-300 hover:bg-green-50 ${sent ? 'opacity-60' : ''} ${className || ''}`}
      onClick={handleSend}
      disabled={sending || sent}
      title={`Send WhatsApp notification to ${mobile}`}
    >
      {sending
        ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
        : <MessageCircle className="w-3.5 h-3.5 mr-1.5" />}
      {sent ? 'Sent' : 'Send Report via WhatsApp'}
    </Button>
  );
}
