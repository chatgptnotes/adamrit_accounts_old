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

function voucherSaveError(error: any): Error {
  const code = error?.code ? ` (${error.code})` : ''
  const message = error?.message || error?.details || error?.hint || 'Unable to save voucher'
  if (String(message).toLowerCase().includes('duplicate') || error?.code === '23505') {
    return new Error(`Voucher number already exists. Please use a different number.${code}`)
  }
  if (error?.code === '23503') {
    return new Error(`One of the selected ledger accounts is invalid for this company.${code}`)
  }
  return new Error(`${message}${code}`)
}

/** Creates an Adamrit accounting voucher and its double-entry rows. */
export async function createAccountingVoucher(input: CreateAccountingVoucherInput) {
  const entries = input.entries.filter((entry) => entry.debitAmount > 0 || entry.creditAmount > 0)
  const debitTotal = entries.reduce((sum, entry) => sum + entry.debitAmount, 0)
  const creditTotal = entries.reduce((sum, entry) => sum + entry.creditAmount, 0)
  if (!input.companyId) throw new Error('Select a company before saving the voucher')
  if (!input.date) throw new Error('Select a voucher date')
  if (!entries.length || debitTotal <= 0 || Math.abs(debitTotal - creditTotal) > 0.01) {
    throw new Error('Voucher debit and credit totals must be equal and greater than zero')
  }

  const accountIds = [...new Set(entries.map((entry) => entry.accountId).filter(Boolean))]
  if (accountIds.length !== entries.length) throw new Error('Select valid ledger accounts for every voucher entry')
  const { data: accounts, error: accountError } = await supabase
    .from('chart_of_accounts')
    .select('id')
    .eq('company_id', input.companyId)
    .in('id', accountIds)
  if (accountError) throw voucherSaveError(accountError)
  if ((accounts || []).length !== accountIds.length) {
    throw new Error('One or more selected ledgers do not belong to the selected company')
  }

  const { data: voucherType, error: typeError } = await supabase
    .from('voucher_types')
    .select('id, voucher_type_code')
    .eq('voucher_category', input.category)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (typeError) throw voucherSaveError(typeError)
  if (!voucherType) throw new Error(`No active ${input.category} voucher type is configured`)

  // The database issues the number and owns the counter — see
  // supabase/migrations/20260731120000_one_voucher_number_series.sql.
  let number = input.voucherNumber?.trim()
  if (!number) {
    const { data: issued, error: numberError } = await supabase.rpc('generate_voucher_number', {
      p_voucher_type_code: voucherType.voucher_type_code,
    })
    if (numberError) throw voucherSaveError(numberError)
    if (!issued) throw new Error(`Could not get a voucher number for ${input.category}`)
    number = issued as string
  }
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
  if (voucherError) throw voucherSaveError(voucherError)

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
    throw voucherSaveError(entryError)
  }

  return voucher
}
