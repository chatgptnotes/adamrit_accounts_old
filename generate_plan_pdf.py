from fpdf import FPDF
import re
import os

class PDF(FPDF):
    def header(self):
        self.set_font('Helvetica', 'B', 13)
        self.set_fill_color(30, 80, 160)
        self.set_text_color(255, 255, 255)
        self.cell(0, 10, 'Adamrit HMS  -  Zoho Books + SBI & Canara Bank Integration Plan', fill=True, ln=True, align='C')
        self.set_text_color(0, 0, 0)
        self.ln(3)

    def footer(self):
        self.set_y(-15)
        self.set_font('Helvetica', 'I', 8)
        self.set_text_color(128, 128, 128)
        self.cell(0, 10, f'Page {self.page_no()}  |  Adamrit HMS Integration Plan  |  2026', align='C')

def clean(text):
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'`([^`]+)`', r'[\1]', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = text.replace('→', '->').replace('←', '<-').replace('↔', '<->')
    text = text.replace('✓', 'OK').replace('✔', 'OK').replace('✕', 'X')
    text = text.replace('—', '--').replace('–', '-').replace(' ', ' ')
    text = text.replace('•', '-').replace('▶', '>').replace('●', '-')
    text = text.replace('“', '"').replace('”', '"')
    text = text.replace('‘', "'").replace('’', "'")
    text = text.encode('latin-1', errors='replace').decode('latin-1')
    return text

def render_md(pdf, content):
    lines = content.split('\n')
    in_code_block = False

    for line in lines:
        line = line.rstrip()

        if line.startswith('```'):
            in_code_block = not in_code_block
            continue

        if in_code_block:
            pdf.set_font('Helvetica', '', 8)
            pdf.set_fill_color(240, 240, 240)
            if line.strip():
                pdf.set_x(10)
                pdf.cell(0, 5, clean(line)[:95], fill=True, ln=True)
            else:
                pdf.ln(2)
            continue

        if line.startswith('# ') and not line.startswith('## '):
            pdf.set_font('Helvetica', 'B', 15)
            pdf.set_text_color(20, 60, 140)
            pdf.set_x(10)
            pdf.multi_cell(0, 8, clean(line[2:]))
            pdf.set_text_color(0, 0, 0)
            pdf.ln(2)

        elif line.startswith('## '):
            pdf.ln(4)
            pdf.set_font('Helvetica', 'B', 12)
            pdf.set_fill_color(210, 228, 255)
            pdf.set_text_color(20, 60, 140)
            pdf.set_x(10)
            pdf.cell(0, 8, clean(line[3:]), fill=True, ln=True)
            pdf.set_text_color(0, 0, 0)
            pdf.ln(1)

        elif line.startswith('### '):
            pdf.ln(3)
            pdf.set_font('Helvetica', 'B', 10)
            pdf.set_text_color(40, 100, 180)
            pdf.set_x(10)
            pdf.multi_cell(0, 6, clean(line[4:]))
            pdf.set_text_color(0, 0, 0)

        elif line.startswith('#### '):
            pdf.ln(2)
            pdf.set_font('Helvetica', 'BI', 9)
            pdf.set_text_color(60, 120, 200)
            pdf.set_x(10)
            pdf.multi_cell(0, 6, clean(line[5:]))
            pdf.set_text_color(0, 0, 0)

        elif line.strip() == '---':
            pdf.ln(2)
            pdf.set_draw_color(180, 180, 180)
            pdf.line(10, pdf.get_y(), 200, pdf.get_y())
            pdf.ln(3)

        elif line.startswith('|') and '|---' not in line and '| ---' not in line:
            cells = [c.strip() for c in line.split('|')[1:-1]]
            if not cells:
                continue
            if pdf.get_y() > 270:
                pdf.add_page()
            n = len(cells)
            if n == 2:
                widths = [75, 115]
            elif n == 3:
                widths = [55, 70, 65]
            elif n == 4:
                widths = [40, 50, 55, 45]
            else:
                widths = [190 // n] * n
            for i, cell in enumerate(cells):
                w = widths[i] if i < len(widths) else 40
                txt = clean(cell)[:45]
                if i == 0:
                    pdf.set_font('Helvetica', 'B', 8)
                    pdf.set_fill_color(200, 218, 255)
                else:
                    pdf.set_font('Helvetica', '', 8)
                    pdf.set_fill_color(245, 248, 255)
                pdf.cell(w, 6, txt, border=1, fill=True)
            pdf.ln()

        elif line.startswith('|---') or line.startswith('| ---'):
            pass

        elif re.match(r'^[-*] ', line):
            pdf.set_font('Helvetica', '', 9)
            pdf.set_x(14)
            pdf.cell(5, 5, '-', ln=False)
            pdf.set_x(19)
            pdf.multi_cell(0, 5, clean(line[2:]))

        elif re.match(r'^\d+\. ', line):
            pdf.set_font('Helvetica', '', 9)
            pdf.set_x(10)
            pdf.multi_cell(0, 5, '  ' + clean(line))

        elif line.startswith('   ') or line.startswith('\t'):
            stripped = line.strip()
            if stripped:
                pdf.set_font('Helvetica', '', 8)
                pdf.set_fill_color(240, 240, 240)
                pdf.set_x(10)
                pdf.cell(0, 5, clean(stripped)[:95], fill=True, ln=True)
                pdf.set_font('Helvetica', '', 9)

        elif line.strip() == '':
            pdf.ln(2)

        else:
            pdf.set_x(10)
            pdf.set_font('Helvetica', '', 9)
            txt = clean(line)
            if txt.strip():
                if '**' in line:
                    pdf.set_font('Helvetica', 'B', 9)
                pdf.multi_cell(0, 5, txt)
                pdf.set_font('Helvetica', '', 9)

# ─── Read existing plan ───────────────────────────────────────────────────────
with open(r'C:/Users/Sonam/.claude/plans/what-is-kohobook-wondrous-spark.md', encoding='utf-8') as f:
    plan_content = f.read()

# ─── New sections to append ──────────────────────────────────────────────────
new_sections = """
---

# PART C: Yojna (Ayushman Bharat) Bulk Payment — Kaise Allocate Karen

## Problem

Jab Ayushman / ESIC / CGHS se ek lump sum payment aata hai (e.g. Rs 4,50,000 bank mein), toh:
- **Kahan se aaya** -- UTR number / bank statement se pata chalta hai
- **Kiske liye aaya** -- ek payment mein 15-20 patients ke claims hote hain, confusion hoti hai

## Abhi System Mein Kya Hai

System mein Corporate Bulk Payment module already present hai (`/corporate-bulk-payments`).

Database structure:

```
corporate_bulk_payments (header)
  corporate_name    : Star Health / ESIC / Ayushman Bharat
  payment_date      : jis din bank mein aaya
  reference_number  : UTR / cheque number
  total_amount      : total jo aaya
  claim_amount      : total jo claim kiya tha

corporate_bulk_payment_allocations (patient-wise split)
  patient_name      : kaun sa patient
  visit_id          : kaun si visit
  amount            : is patient ke liye kitna mila
  bill_amount       : original bill tha kitna
  deduction_amount  : kitna kata (disallowance)
  tds_amount        : TDS kitna kata
```

## Yojna Payment Kaise Enter Karen (Current Process)

1. Ayushman portal se **Claim Advice Sheet** download karo (Excel/PDF)
2. System mein Corporate Bulk Payment form open karo
3. Corporate Name = "Ayushman Bharat" select karo
4. UTR number daalo (jo bank statement mein aaya)
5. Har patient ko manually allocate karo:
   - Patient name search karo
   - Visit select karo
   - Amount daalo (claim advice sheet se)
   - Deduction amount daalo (agar kata ho)

## Claim Advice Sheet Mein Kya Hota Hai

| Column | Matlab |
|--------|--------|
| Patient Name | Kaun sa patient |
| Admission Date | Kab admit tha |
| Package Code | Kaun sa treatment |
| Claim Amount | Kitna approve hua |
| Deduction | Kitna kata gaya |
| Net Amount | Final mila |

## Future Enhancement -- Excel Import Feature

Agar manual entry avoid karni hai, ek **Excel Import** feature add kiya ja sakta hai:
- Claim Advice Sheet upload karo
- System automatically patients ko match kare (name + date se)
- Allocation auto-fill ho jaye
- Sirf mismatches manually correct karo

---

# PART D: Next Steps -- Priority Order

## Step 1 -- Zoho Books Account Setup (Fastest, Do Today)

1. `zoho.com/in/books` pe sign up karo (hospital GST number se)
2. Company setup complete karo (name, GSTIN, financial year start)
3. `api-console.zoho.in` pe app register karo:
   - App Name: "Adamrit HMS"
   - Redirect URI: your Vercel app URL + `/api/zoho-books-proxy?action=oauth-callback`
4. Client ID + Client Secret copy karo
5. Vercel environment variables mein add karo:
   - ZOHO_CLIENT_ID
   - ZOHO_CLIENT_SECRET

## Step 2 -- SBI Bank API Registration (1-2 Business Days)

1. `apihub.yonobusiness.sbi` pe sign up karo
2. Application create karo: "Adamrit HMS Integration"
3. APIs subscribe karo: Account Balance + Account Statement
4. SBI approval ka wait karo
5. Client ID + Secret Key milega
6. Server IP whitelist karo (Vercel ka IP)

## Step 3 -- Canara Bank API Application (5-10 Business Days)

1. Nearest Canara Bank branch se API Banking Corporate form lo
2. Fill karo: Company name, account number, purpose
3. Documents attach karo: Board resolution, company KYC, authorized signatory KYC
4. Relationship manager ke paas submit karo
5. Credentials milne ka wait karo

## Step 4 -- Code Implementation (After Credentials)

Jab credentials mil jayein, yeh files banana hai (plan already ready):

| Step | File | Time |
|------|------|------|
| DB migration | supabase/migrations/20260526_zoho_books.sql | 30 min |
| Types | src/types/zoho-books.ts + bank-api.ts | 30 min |
| Zoho proxy | api/zoho-books-proxy.ts | 2 hrs |
| Bank proxy | api/bank-proxy.ts | 2 hrs |
| Auto-push | src/lib/zoho-books-auto-push.ts | 2 hrs |
| UI screens | src/components/zoho-books/ (7 files) | 4 hrs |
| Bank UI | src/components/bank-integration/ (5 files) | 3 hrs |
| Routes + sidebar | AppRoutes.tsx + menuItems.ts | 30 min |

## Step 5 -- Yojna Excel Import (Optional Enhancement)

After main integration is live:
- Excel upload component for Claim Advice Sheet
- Auto-match patients by name + admission date
- Bulk allocation from one Excel file

## Environment Variables Needed in Vercel

```
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
SBI_CLIENT_ID=
SBI_SECRET_KEY=
CANARA_CLIENT_ID=
CANARA_CLIENT_SECRET=
```

## Estimated Timeline

| Task | Timeline |
|------|----------|
| Zoho Books setup | Today (30 min) |
| SBI API approval | 2-3 business days |
| Canara Bank approval | 7-10 business days |
| Code implementation | 2-3 days after credentials |
| Testing + go-live | 1-2 days |
| **Total** | **2-3 weeks** |
"""

full_content = plan_content + new_sections

# ─── Generate PDF ─────────────────────────────────────────────────────────────
pdf = PDF()
pdf.set_auto_page_break(auto=True, margin=20)
pdf.add_page()
render_md(pdf, full_content)

out = r'C:/Users/Sonam/adamrith.com/adamrit/docs/Zoho-Books-Bank-Integration-Plan.pdf'
os.makedirs(os.path.dirname(out), exist_ok=True)
pdf.output(out)
print('PDF updated at:', out)
