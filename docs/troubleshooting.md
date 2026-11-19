# Troubleshooting

Preserve the original wallet, local state, purchase ID, order ID, checkout and transaction hashes before diagnosing a failure. The recovery path should reconcile the original economic action.

## MCP will not start

Check Node.js 24+, installed dependencies, the absolute wrapper path, absolute mandate/wallet paths and owner-only wallet permissions. The wallet's address must match its private key.

Use the repository wrapper directly. STDIO reserves stdout for protocol messages, so an extra shell banner or npm script output can break the client transport.

An unapproved origin or malformed budget fails before purchase. `PER_PURCHASE_BUDGET_EXCEEDED` and `DAILY_BUDGET_EXCEEDED` require a task within the existing mandate or separately authorized limit changes.

## Authentication fails

Check the exact merchant origin, wallet address and local clock. Sign the exact issued message after validating its chain, network, nonce and expiry. A challenge expires after five minutes and can be used once.

A 401 may need a fresh session; the local client normally renews it. A browser Origin mismatch returns 403. A 429 requires waiting for the quota window rather than issuing repeated challenges.

## Purchase is disabled

Read `/api/v1/service`. `purchase:false` indicates missing required seller/payment/court/durable-state configuration. `generation:false` means the live seller generator is unavailable.

Public buyers do not repair this by requesting an operator token. The operator must configure the deployment. An explicitly labelled fixture is a different delivery mode, not a silent fallback for live work.

## Quote submission is uncertain

Once a durable purchase exists, a pending or failed tool result can return `recovery:{purchaseId,orderId,caseId}` alongside `ok:false` and a safe error code. Order and case IDs remain null until known. Save those identifiers and use `resume_purchase` with `recovery.purchaseId` and the same wallet/state directory.

An authentication or discovery failure before quote submission leaves the purchase resumable. If the quote request may have been submitted but its order identity was not recorded, `QUOTE_OUTCOME_UNKNOWN_USE_ORIGINAL` stops automatic requoting. Reconcile the original order from merchant/local records; the current MCP tool does not accept a replacement order or reset that intent. Preserve the state and involve the operator rather than create a second purchase.

`PURCHASE_IN_PROGRESS` means an original attempt is active; wait and resume that purchase. A transient preflight failure can be retried after its cause is resolved. A quote-outcome uncertainty requires original-order reconciliation and must not be cleared by deleting local state.

## Quote expired

An unpaid quote expires after its agreed interval. Resolve whether any original authorization could have settled before creating a new order. A genuinely unpaid expired quote can be replaced; an uncertain paid checkout requires reconciliation.

A quote, acceptance or checkout binding mismatch is not a transient retry error. Inspect the original stored agreement, signer, resource and authorization.

## Payment or delivery is pending

A 202 delivery response means the service has not produced verified delivery. Resume with `resume_purchase` and the original purchase ID. Preserve the same state directory.

A lost response can occur after an authorization settled. Do not replace it with a new nonce. A consumed or canceled nonce without the required matching transfer proof remains unresolved.

`DELIVERY_IN_PROGRESS`, `STATE_CONFLICT` and `RETRY_REQUEST` can result from concurrent work. Retry the same original action after the ongoing attempt finishes.

## Review is rejected

Read the full original answer and exact rubric. Acceptance requires no material failure and no failed criterion IDs. Dispute requires a material failure and applicable unique criteria.

Every submitted quote must appear verbatim in the original delivery. Reasons and excerpts must fit UTF-8 byte limits. The first committed review is immutable; a different later review produces a conflict.

A deadline failure reflects the signed dispute window. The public API does not reopen it with rewritten evidence.

## Court remains pending

Registration must finalize before adjudication begins. Court acceptance is provisional; finality may take longer than a CLI's bounded wait.

`COURT_SUBMISSION_RECONCILIATION_REQUIRED` means submission identity became ambiguous. Preserve the stored job and obtain chain evidence before another write.

After a court upgrade, inspect the original signed agreement's court and verify that the configured registrar can still operate that instance. Existing cases are not moved to the new court.

Failed, undetermined or insufficient-evidence outcomes remain visible. They cannot be converted into a refund by selecting the fixture's expected result.

## Final refund award, no return transfer

Inspect refund status and diagnostic events. The seller may need USDC reserve, gas, a valid authorization window, receipt confirmation or bounded nonce-history reconciliation.

A consumed nonce alone does not prove repayment. Contradictory or mismatched transaction evidence fails closed. Report the actual state and existing hashes while the operator investigates.

## Worker wake does not advance the case

Read `GET /api/v1/activity/status`, including `automation.enabled`, `status`, `retryAfterSeconds` and `errorCode`. A public wake requires `{}`, no buyer/operator token, and a matching Origin header if supplied. A shared 60-second cooldown or active 120-second lease can defer another visitor step.

A wake processes at most one eligible paid dispute from the bounded scan. `processed` describes that step, not completion of the selected case. It may select another case first; follow your case's actual state. `failed` with `WORKER_STEP_FAILED` requires inspection of safe worker diagnostics and the original durable job. The site invokes its API directly and does not dispatch GitHub Actions.

GitHub schedules can be delayed, dropped or disabled after 60 days of public-repository inactivity. Preserve the durable job and use the authenticated processing endpoint or trusted worker CLI. A visitor request does not reset inactivity or re-enable a disabled schedule. Check the workflow's enabled state, default-branch configuration and operator secret separately. The viewer can still display its last recorded state.

## Independent verification

Use the explorer links and original evidence alongside the proof manifest. A page label, transaction hint, CLI exit code or court deployment alone does not prove a completed refund.

[Evidence](evidence.md) · [State machine](state-machine.md) · [Authentication](authentication.md) · [Verified live proof](live-proof.md)
