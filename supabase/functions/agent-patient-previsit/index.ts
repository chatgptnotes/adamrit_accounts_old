// =============================================================================
// agent-patient-previsit — drafts SMS + email pre-visit instructions.
//
// PHI handling:
//   - Edge Function reads patient record, but de-identifies before LLM call.
//   - Only first_name + age + language survive into the LLM prompt.
//   - Output is reviewed by front-desk staff before send (Phase 0 trust < 9/10).
// =============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient, getInvokerId } from '../_shared/service-client.ts';
import { invokePack, loadPack } from '../_shared/loader.ts';
import { audit } from '../_shared/audit.ts';
import { deidentifyObject } from '../_shared/deidentify.ts';
import { manifest, systemPrompt, knowledgeFiles, exampleFiles } from './pack.ts';

interface RequestBody { appointment_id: string; language?: 'en' | 'hi' | 'mr' }

const VERTEX_REGION = Deno.env.get('VERTEX_REGION') ?? 'asia-south1';

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
        if (!body.appointment_id) throw new Error('appointment_id required');

        const { data: appt, error: aerr } = await supabase
            .from('appointments')
            .select('id, type, datetime_local, location, doctor, patient_id, send_reminder, do_not_contact')
            .eq('id', body.appointment_id)
            .single();
        if (aerr || !appt) throw new Error(`appointment not found: ${aerr?.message}`);
        if ((appt as Record<string, unknown>).do_not_contact) throw new Error('Patient flagged do_not_contact');

        const { data: patient, error: perr } = await supabase
            .from('patients')
            .select('id, first_name, last_name, dob, language_preference')
            .eq('id', (appt as Record<string, unknown>).patient_id)
            .single();
        if (perr || !patient) throw new Error(`patient not found: ${perr?.message}`);

        const { data: template, error: terr } = await supabase
            .from('appointment_type_templates')
            .select('preparation_steps, items_to_bring, duration_minutes, arrive_early_minutes')
            .eq('type', (appt as Record<string, unknown>).type)
            .single();
        if (terr || !template) {
            // Escalate: no template
            const empty = { sms: '', email_subject: '', email_body: '', language: body.language ?? 'en', confidence: 0, needs_human: true, disclaimer: 'No template available — front-desk to draft manually.' };
            return new Response(JSON.stringify(empty), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const dob = (patient as Record<string, unknown>).dob as string | null;
        const age = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / 31_557_600_000) : null;
        const fullName = [(patient as Record<string, unknown>).first_name, (patient as Record<string, unknown>).last_name].filter(Boolean).join(' ');

        const llmPayload = {
            appointment: {
                id: 'REDACTED',
                type: (appt as Record<string, unknown>).type,
                datetime_local: (appt as Record<string, unknown>).datetime_local,
                location: (appt as Record<string, unknown>).location,
                doctor: (appt as Record<string, unknown>).doctor,
            },
            template,
            patient: {
                first_name: (patient as Record<string, unknown>).first_name,
                age,
                language: body.language ?? (patient as Record<string, unknown>).language_preference ?? 'en',
            },
            hospital_contact: Deno.env.get('HOSPITAL_CONTACT') ?? '+91-XX-XXXXXXXX',
        };

        // Defensive de-identify (catches any straggler PHI)
        const { value: clean, replacedCount } = deidentifyObject(llmPayload, [fullName].filter(Boolean));
        deidentifiedCount = replacedCount;

        const llm = await invokePack({
            pack,
            userMessage: JSON.stringify(clean),
            retrievalBlock: '',
        });

        try { result = JSON.parse(llm.text); }
        catch {
            const m = llm.text.match(/\{[\s\S]*\}/);
            result = m ? JSON.parse(m[0]) : { sms:'', email_subject:'', email_body: llm.text, language: 'en', confidence: 0.5, needs_human: true, disclaimer: 'Parsing failed — please review.' };
        }

        await audit(supabase, {
            invokedBy: invokerId,
            agentSlug: manifest.name,
            packVersion: manifest.version,
            rawInput: { appointment_id: body.appointment_id, language: body.language },
            rawOutput: result,
            retrievedChunks: [],
            llmProvider: 'vertex-ai',
            llmModel: manifest.llm.model,
            llmRegion: VERTEX_REGION,
            deidentifiedCount,
            confidence: (result as { confidence?: number }).confidence ?? null,
            handedToHuman: true,
        });

        await supabase.from('agent_runs').insert({
            session_id: crypto.randomUUID(),
            agent_slug: manifest.name,
            invoked_by: invokerId,
            question: `pre-visit ${body.appointment_id}`,
            answer: JSON.stringify({ language: (result as { language?: string }).language, confidence: (result as { confidence?: number }).confidence }),
            confidence: (result as { confidence?: number }).confidence ?? null,
            cycles: 1,
            handed_to_human: true,
            duration_ms: Date.now() - startedAt,
        });

        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
        const msg = (e as Error).message;
        console.error('[agent-patient-previsit]', msg);
        await audit(supabase, {
            invokedBy: invokerId, agentSlug: manifest.name, packVersion: manifest.version,
            rawInput: 'error path', rawOutput: null, retrievedChunks: [],
            llmProvider: 'vertex-ai', llmModel: manifest.llm.model, llmRegion: VERTEX_REGION,
            deidentifiedCount, confidence: null, handedToHuman: false, errorMessage: msg,
        });
        return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
});
