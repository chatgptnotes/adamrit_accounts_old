/**
 * Business Brain client — typed wrappers around the agent-* Edge Functions.
 *
 * Every agent invocation goes through one of the helpers here so feature flags,
 * error handling, and telemetry stay in one place.
 *
 * Feature flags (env, set in Vercel + .env.local):
 *   VITE_BRAIN_ENABLED            master switch
 *   VITE_BRAIN_PHARMACY           pharmacy reorder agent
 *   VITE_BRAIN_PATIENT_PREVISIT   patient pre-visit instructions agent
 *   VITE_BRAIN_CLINICAL_BRIEF     clinician prior-visit briefer
 */

import { supabase } from '@/integrations/supabase/client';

export const brainEnabled = import.meta.env.VITE_BRAIN_ENABLED === 'true';

export const brainFlags = {
    pharmacy:       brainEnabled && import.meta.env.VITE_BRAIN_PHARMACY === 'true',
    patientPrevisit: brainEnabled && import.meta.env.VITE_BRAIN_PATIENT_PREVISIT === 'true',
    clinicalBrief:  brainEnabled && import.meta.env.VITE_BRAIN_CLINICAL_BRIEF === 'true',
};

// -----------------------------------------------------------------------------
// Pharmacy reorder
// -----------------------------------------------------------------------------
export interface PharmacyReorderItem {
    medicine_id: string;
    medicine_name: string;
    on_hand: number;
    avg_daily_sales: number;
    days_of_cover: number;
    suggested_qty: number;
    supplier?: string;
    expected_stockout: string | null;
    confidence: number;
    rationale: string;
}

export interface PharmacyReorderResponse {
    items: PharmacyReorderItem[];
    notes: string[];
    needs_human: boolean;
    generated_at: string;
}

export async function invokePharmacyReorder(input: { hospital_id?: string; horizon_days?: number } = {}): Promise<PharmacyReorderResponse> {
    if (!brainFlags.pharmacy) throw new Error('Pharmacy agent disabled (VITE_BRAIN_PHARMACY=false)');
    const { data, error } = await supabase.functions.invoke('agent-pharmacy-reorder', { body: input });
    if (error) throw new Error(`pharmacy-reorder: ${error.message}`);
    return data as PharmacyReorderResponse;
}

// -----------------------------------------------------------------------------
// Patient pre-visit instructions
// -----------------------------------------------------------------------------
export interface PreVisitDraft {
    sms: string;
    email_subject: string;
    email_body: string;
    language: 'en' | 'hi' | 'mr';
    confidence: number;
    needs_human: boolean;
    disclaimer: string;
}

export async function invokePatientPreVisit(input: {
    appointment_id: string;
    language?: 'en' | 'hi' | 'mr';
}): Promise<PreVisitDraft> {
    if (!brainFlags.patientPrevisit) throw new Error('Patient pre-visit agent disabled (VITE_BRAIN_PATIENT_PREVISIT=false)');
    const { data, error } = await supabase.functions.invoke('agent-patient-previsit', { body: input });
    if (error) throw new Error(`patient-previsit: ${error.message}`);
    return data as PreVisitDraft;
}

// -----------------------------------------------------------------------------
// Clinician prior-visit brief
// -----------------------------------------------------------------------------
export interface PriorVisitBrief {
    timeline: { date: string; type: string; doctor: string; summary: string }[];
    active_issues: string[];
    medication_list: { name: string; dose: string; since: string }[];
    new_in_last_30_days: string[];
    suggested_questions: string[];
    confidence: number;
    disclaimer: string;
}

export async function invokeClinicalPriorVisit(input: {
    patient_id: string;
    appointment_id: string;
}): Promise<PriorVisitBrief> {
    if (!brainFlags.clinicalBrief) throw new Error('Clinical brief agent disabled (VITE_BRAIN_CLINICAL_BRIEF=false)');
    const { data, error } = await supabase.functions.invoke('agent-clinical-priorvisit', { body: input });
    if (error) throw new Error(`clinical-priorvisit: ${error.message}`);
    return data as PriorVisitBrief;
}
