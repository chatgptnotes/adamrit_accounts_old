// =============================================================================
// agent-clinical-priorvisit — 1-page brief of patient's recent history.
//
// PHI handling:
//   - Reads last 5 visits, active meds, recent labs, active diagnoses.
//   - De-identifies free-text fields BEFORE LLM call (Vertex AI asia-south1).
//   - Output is read-only by the clinician — no auto-action ever.
//   - Honours consent_for_ai + parental_consent_for_ai patient flags.
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient, getInvokerId } from '../_shared/service-client.ts';
import { invokePack, loadPack } from '../_shared/loader.ts';
import { audit } from '../_shared/audit.ts';
import { deidentifyObject } from '../_shared/deidentify.ts';
import { manifest, systemPrompt, knowledgeFiles, exampleFiles } from './pack.ts';

interface RequestBody { patient_id: string; appointment_id: string }

const VERTEX_REGION = Deno.env.get('VERTEX_REGION') ?? 'asia-south1';
const NO_BRIEF = (reason: string) => ({
    timeline: [], active_issues: [], medication_list: [], new_in_last_30_days: [],
    suggested_questions: [], confidence: 0,
    disclaimer: `AI brief unavailable: ${reason}. Please review chart manually.`,
});

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const startedAt = Date.now();
    const supabase = getServiceClient();
    const invokerId = getInvokerId(req);
    const pack = loadPack({ manifest, systemPrompt, knowledgeFiles, exampleFiles });

    let deidentifiedCount = 0;
    let result: unknown = null;

    try {
        const body: RequestBody = await req.json();
        if (!body.patient_id || !body.appointment_id) throw new Error('patient_id and appointment_id required');

        // Consent gate
        const { data: patient, error: perr } = await supabase
            .from('patients')
            .select('id, first_name, last_name, dob, sex, consent_for_ai, parental_consent_for_ai')
            .eq('id', body.patient_id)
            .single();
        if (perr || !patient) throw new Error(`patient not found: ${perr?.message}`);
        const p = patient as Record<string, unknown>;
        const dob = p.dob as string | null;
        const ageYears = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31_557_600_000) : null;

        if (p.consent_for_ai === false) {
            result = NO_BRIEF('patient has not consented to AI summarisation');
            return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (ageYears !== null && ageYears < 18 && p.parental_consent_for_ai !== true) {
            result = NO_BRIEF('parental consent not on file for minor');
            return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

        // Pull all the data in parallel
        const [{ data: visits }, { data: meds }, { data: labs }, { data: dx }] = await Promise.all([
            supabase.from('visits').select('admission_date, visit_type, attending_doctor, chief_complaint, assessment, plan').eq('patient_id', body.patient_id).order('admission_date', { ascending: false }).limit(5),
            supabase.from('prescriptions').select('medicine_name, dose, frequency, started_at').eq('patient_id', body.patient_id).is('stopped_at', null),
            supabase.from('lab_results').select('test_name, value, unit, ref_range, abnormal_flag, result_date').eq('patient_id', body.patient_id).gte('result_date', since30),
            supabase.from('patient_diagnoses').select('icd10, description, since').eq('patient_id', body.patient_id).is('resolved_at', null),
        ]);

        const llmPayload = {
            patient: { age: ageYears, sex: p.sex },
            visits: (visits ?? []).map(v => ({
                date: (v as Record<string, unknown>).admission_date,
                type: (v as Record<string, unknown>).visit_type,
                doctor: (v as Record<string, unknown>).attending_doctor,
                chief_complaint: (v as Record<string, unknown>).chief_complaint,
                assessment: (v as Record<string, unknown>).assessment,
                plan: (v as Record<string, unknown>).plan,
            })),
            medications_active: (meds ?? []).map(m => ({
                name: (m as Record<string, unknown>).medicine_name,
                dose: (m as Record<string, unknown>).dose,
                frequency: (m as Record<string, unknown>).frequency,
                started_at: (m as Record<string, unknown>).started_at,
            })),
            labs_30d: labs ?? [],
            diagnoses_active: dx ?? [],
        };

        const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ');
        const { value: clean, replacedCount } = deidentifyObject(llmPayload, [fullName].filter(Boolean));
        deidentifiedCount = replacedCount;

        const llm = await invokePack({ pack, userMessage: JSON.stringify(clean), retrievalBlock: '' });

        try { result = JSON.parse(llm.text); }
        catch {
            const m = llm.text.match(/\{[\s\S]*\}/);
            result = m ? JSON.parse(m[0]) : NO_BRIEF('LLM returned non-JSON output');
        }

        await audit(supabase, {
            invokedBy: invokerId,
            agentSlug: manifest.name,
            packVersion: manifest.version,
            rawInput: { patient_id: body.patient_id, appointment_id: body.appointment_id },
            rawOutput: result,
            retrievedChunks: [],
            llmProvider: 'vertex-ai',
            llmModel: manifest.llm.model,
            llmRegion: VERTEX_REGION,
            deidentifiedCount,
            confidence: (result as { confidence?: number }).confidence ?? null,
            handedToHuman: false,
        });

        await supabase.from('agent_runs').insert({
            session_id: crypto.randomUUID(),
            agent_slug: manifest.name,
            invoked_by: invokerId,
            question: `prior-visit ${body.patient_id} → appt ${body.appointment_id}`,
            answer: JSON.stringify({ confidence: (result as { confidence?: number }).confidence }),
            confidence: (result as { confidence?: number }).confidence ?? null,
            cycles: 1,
            handed_to_human: false,
            duration_ms: Date.now() - startedAt,
        });

        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
        const msg = (e as Error).message;
        console.error('[agent-clinical-priorvisit]', msg);
        await audit(supabase, {
            invokedBy: invokerId, agentSlug: manifest.name, packVersion: manifest.version,
            rawInput: 'error path', rawOutput: null, retrievedChunks: [],
            llmProvider: 'vertex-ai', llmModel: manifest.llm.model, llmRegion: VERTEX_REGION,
            deidentifiedCount, confidence: null, handedToHuman: false, errorMessage: msg,
        });
        return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
