import type { PayslipMime } from '@/lib/payslips/rules'

/** One payslip as the pages hand it to the client: the row, plus the person's name resolved on the server. */
export interface PayslipItem {
  id: string
  staff_id: string
  staffName: string
  period: string
  file_name: string
  file_mime: PayslipMime
  file_bytes: number
  uploaded_at: string
  uploaded_by_name: string
  note: string
  /** When the EMPLOYEE first opened it (null = not yet). */
  employee_first_viewed_at: string | null
}

export interface RosterOption {
  id: string
  name: string
  names: string[]
  badge: string | null
  linked: boolean
}
