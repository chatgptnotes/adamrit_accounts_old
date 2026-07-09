import { supabase } from "@/integrations/supabase/client";

async function isTallyActive() {
  const { data } = await supabase.from("tally_config").select("*").eq("is_active", true).limit(1).single();
  if (!data) return { active: false, serverUrl: "", companyName: "", companyId: "" };
  return { active: true, serverUrl: data.server_url, companyName: data.company_name, companyId: data.id };
}

export async function processRetryQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
  void supabase;
  return { processed: 0, succeeded: 0, failed: 0 };
}

export async function getQueueStats() {
  void supabase;
  return { pending: 0, failedPermanent: 0, completed: 0 };
}

export async function retryItem(id: string) {
  void id;
}

export async function deleteQueueItem(id: string) {
  void id;
}
