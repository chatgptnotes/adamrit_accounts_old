import { supabase } from '@/integrations/supabase/client'

export type AccountingVoucherEntry = {
  accountId: string
  debitAmount: number
  creditAmount: number
  narration?: string
}

type CreateAccountingVoucherInput = {
  companyId: string
  category: string
  date: string
  narration?: string
  referenceNumber?: string
  voucherNumber?: string
  entries: AccountingVoucherEntry[]
}

function voucherNumber(prefix: string, currentNumber: number) {
  return `${prefix}${String(currentNumber + 1).padStart(4, '0')}`
}

/** Creates an Adamrit accounting voucher and its double-entry rows. */
export async function createAccountingVoucher(input: CreateAccountingVoucherInput) {
  const entries = input.entries.filter((entry) => entry.debitAmount > 0 || entry.creditAmount > 0)
  const debitTotal = entries.reduce((sum, entry) => sum + entry.debitAmount, 0)
  const creditTotal = entries.reduce((sum, entry) => sum + entry.creditAmount, 0)
  if (!entries.length || debitTotal <= 0 || Math.abs(debitTotal - creditTotal) > 0.01) {
    throw new Error('Voucher debit and credit totals must be equal and greater than zero')
  }

  const { data: voucherType, error: typeError } = await supabase
    .from('voucher_types')
    .select('id, prefix, current_number')
    .eq('voucher_category', input.category)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (typeError) throw typeError
  if (!voucherType) throw new Error(`No active ${input.category} voucher type is configured`)

  const nextNumber = (voucherType.current_number || 0) + 1
  const number = input.voucherNumber?.trim() || voucherNumber(voucherType.prefix || '', voucherType.current_number || 0)
  const { data: voucher, error: voucherError } = await supabase
    .from('vouchers')
    .insert({
      voucher_number: number,
      voucher_type_id: voucherType.id,
      voucher_date: input.date,
      reference_number: input.referenceNumber?.trim() || null,
      narration: input.narration?.trim() || '',
      total_amount: debitTotal,
      company_id: input.companyId,
      status: 'AUTHORISED',
      is_optional: false,
      created_by: 'system',
      last_modified_by: 'system',
    })
    .select('id, voucher_number')
    .single()
  if (voucherError) throw voucherError

  const { error: entryError } = await supabase.from('voucher_entries').insert(
    entries.map((entry, index) => ({
      voucher_id: voucher.id,
      account_id: entry.accountId,
      debit_amount: entry.debitAmount,
      credit_amount: entry.creditAmount,
      narration: entry.narration || '',
      entry_order: index + 1,
    })),
  )
  if (entryError) {
    await supabase.from('vouchers').delete().eq('id', voucher.id)
    throw entryError
  }

  const { error: counterError } = await supabase
    .from('voucher_types')
    .update({ current_number: nextNumber })
    .eq('id', voucherType.id)
  if (counterError) throw counterError

  return voucher
}
