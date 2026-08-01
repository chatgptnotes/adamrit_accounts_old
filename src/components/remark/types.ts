// One claim off the ESIC scrutiny export, as the Remark tab works with it.
export interface ClaimRemark {
  id: string;
  claim_id: string;
  patient_name: string | null;
  uhid: string | null;
  card_id: string | null;
  approved_amount: number | null;
  process_stage: string | null;
  admission_type: string | null;
  hospital: string | null;
  l2_remark: string | null;
  justification: string | null;
}

export const CLAIM_COLUMNS =
  'id, claim_id, patient_name, uhid, card_id, approved_amount, process_stage, admission_type, hospital, l2_remark, justification';
