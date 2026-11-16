# Bamoke Hardware POS System — Security Specification

## 1. Data Invariants
1. Every document in `/stores/{storeId}` and all nested subcollections MUST have `ownerId == request.auth.uid` (unless operated by a verified bootstrapped admin `masiboaustin@gmail.com`).
2. `request.auth != null && request.auth.token.email_verified == true` is enforced on all mutations and private reads.
3. `UserProfile` documents in `/users/{userId}` can only be read/written by `request.auth.uid == userId` (or admin), and users cannot escalate their `role` field on update.
4. `Product` stockQuantity, costPrice, and sellingPrice must always be `>= 0` and `is number`.
5. `Sale` documents using `mpesa_paybill` or `split` MUST include a valid 10-character uppercase alphanumeric `mpesaCode` matching `^[A-Z0-9]{10}$` and `mpesaAmount > 0`. Cash-only sales must have `mpesaCode == ''` and `mpesaStatus == 'not_applicable'`.
6. Once a `Sale` reaches terminal status `'voided'`, no further updates are permitted (except admin override).
7. `SaleLineItem` documents under `/stores/{storeId}/sales/{saleId}/items/{itemId}` cannot be orphaned — `saleId` must match the path `{saleId}` and the parent sale must exist (or existAfter in the same batch).
8. `StockLog` entries are append-only immutable audit records; updates and deletes are denied.
9. Once a `DailyReconciliation` reaches terminal status `'closed'`, it cannot be overwritten or altered (except admin override).
10. All `createdAt` and `updatedAt` timestamps MUST equal `request.time`, and `createdAt` and `ownerId` are immutable after creation.
11. Every `allow list` rule evaluates `resource.data.ownerId == request.auth.uid || isAdmin()` with zero `get()` or `exists()` calls.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Product Read**: Anonymous client queries `/stores/store1/products` -> Denied (`isSignedIn()` false).
2. **Cross-Tenant List Scraping**: Authenticated User B lists `/stores/storeA/sales` -> Denied (`resource.data.ownerId != UserB.uid`).
3. **Identity Spoofing on Sale Create**: User A creates sale in `/stores/storeA/sales/s1` with `ownerId: "userB"` -> Denied (`incoming().ownerId == request.auth.uid`).
4. **Shadow Field Injection**: User A creates product with extra ghost field `isVerified: true` -> Denied (`keys().hasOnly(...)` fails).
5. **1MB ID Poisoning**: User A writes to `/stores/storeA/products/<1500-char-id>` -> Denied (`isValidId(productId)` fails).
6. **Invalid M-Pesa Confirmation Code**: User A creates `mpesa_paybill` sale with `mpesaCode: "ABC123"` (6 chars instead of 10) -> Denied (`mpesaCode.matches('^[A-Z0-9]{10}$')` fails).
7. **Negative Stock Manipulation**: User A updates product with `stockQuantity: -5` -> Denied (`stockQuantity >= 0` fails).
8. **Timestamp Spoofing**: User A creates sale with client-forged `createdAt: "2020-01-01T00:00:00Z"` -> Denied (`incoming().createdAt == request.time` fails).
9. **Terminal State Mutation (Voided Sale)**: User A tries to change `status` of a `'voided'` sale back to `'completed'` -> Denied (`existing().status != 'voided'`).
10. **Terminal State Mutation (Closed Shift)**: User A tries to edit `countedCash` on a `'closed'` daily reconciliation -> Denied (`existing().status != 'closed'`).
11. **StockLog Tampering**: User A tries to update or delete an existing `StockLog` audit record -> Denied (`allow update, delete: if false`).
12. **Email Spoofing Without Verification**: Attacker signs in with unverified `masiboaustin@gmail.com` (`email_verified: false`) -> Denied (`request.auth.token.email_verified == true` fails).
