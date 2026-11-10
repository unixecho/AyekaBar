# Stock, OMS integration, and checklists — implementation contract

Status: design for the work following approval of the real-data glass preview. No stock or checklist schema has been applied.

## Stock

The developer enters suppliers, purchase orders and delivery receipts. A receipt has supplier reference, delivery date, optional invoice reference, line items, unit and quantity, unit cost, tax/currency fields as needed, and an attachment reference. Saving a draft does not change stock. Posting a receipt creates immutable stock movements in one SQL transaction, keyed by a unique receipt idempotency key; repeating a request returns the first result. Corrections create reversing movements with a reason and actor. A physical count creates variance movements rather than rewriting a balance.

Stock items use a canonical base unit (for example millilitres, grams, or pieces). Pack sizes and conversions are explicit, versioned values. A recipe maps a published menu variant to ingredient quantities in base units. Availability/86 is a distinct operational flag, never inferred from an unreliable balance. The current inventory balance is the sum of movements; the ledger is the audit source. Low-stock thresholds and waste/return categories are derived from that ledger.

When payments are integrated, the **confirmed paid-sale event**, not an OMS ticket draft, consumes stock exactly once using the payment event id and the recipe version effective for that sale. Refund/void events reverse the corresponding consumption once. A reconciliation view ties receipts, sales, waste, adjustments and closing balances to business dates and item/variant ids. BI reports use this same event stream for sell-through, gross margin estimates, variance and waste; they must label missing recipes and unknown costs rather than manufacturing numbers.

The stock UI/API and every write path are developer-only until a separate release decision. Database tables use RLS and explicit grants. The developer identity is OP plus the existing Dev badge, with badge assignment blocked through the ordinary roster API. Migration SQL is drafted and checked locally, then reviewed per migration before production apply.

## Checklists and form builder

Port Sarcafe's versioned template, assignment snapshot, submission and issue model from its `docs/STAFF_CHECKLISTS.md`, `ChecklistBuilder.tsx`, server helpers, migrations and harnesses. **Kitchen, Floor and Bar are departments**, independent of opening, handover and closing form type. Ayeka's Google staff account and shift schedule provide identity and assignment; Sarcafe's branch and employee PIN assumptions do not carry over.

The builder needs ordered sections and questions; status, action, number, text, photo and choice fields; required/optional rules; number min/max and unit; help text; issue category; and conditional follow-up questions with a clearly visible rule preview. It should support duplicate, reorder, archive, draft autosave, validation before publish, and a true employee preview that never creates a submission. Publish uses a version check so two owners cannot silently overwrite each other. A submitted form keeps the exact template snapshot and answers, actor, shift, timestamps and attestation; later template edits cannot rewrite history.

The owner and developer build the Kitchen, Floor and Bar forms together. No restaurant-specific question text is prefilled as if the owner had approved it. Draft templates may start blank. Every field label, validation message and status in the new UI has Hebrew, English and Arabic copy, with Hebrew as default. The glass visual system follows the approved preview, including safe-area and fixed save-bar behavior.

QA cases are listed in `docs/QA_BLUEPRINT.md`. Required checks include preview-vs-submit isolation, required/conditional/range validation, concurrent publish conflict, duplicate submission, reassignment after a shift change, late/overnight windows, history immutability, and access by every staff role.

## Next applications

After the web work is approved, prepare store-approved customer menu/loyalty, OMS tablet, and staff/management apps. Share business rules and API contracts, not local storage or unreviewed privileged database credentials. Store submission, payment and inventory event ids must remain stable across clients to preserve exactly-once accounting.
