import type { CaseManifest } from '../src/domain/schema.js';
import {
	formatMoney,
	shortHash,
	statusLabel,
	sourceLabel,
	proofLinks,
	displayTime,
} from './model.js';
import { stagesFor, outcomeFor } from './presentation.js';
import { EvidenceInspector } from './evidence-inspector.js';
import { caseTitle } from './protocol-model.js';

function ReceiptLink({
	label,
	url,
	hash,
}: {
	label: string;
	url: string | null;
	hash?: string | null;
}) {
	return (
		<div className="receipt-row">
			<span>{label}</span>
			{url ? (
				<a href={url} target="_blank" rel="noopener noreferrer">
					{hash ? shortHash(hash) : 'Open contract'}
					<span className="external-mark" aria-hidden="true">
						↗
					</span>
				</a>
			) : (
				<span className="muted">Not published</span>
			)}
		</div>
	);
}
export function CaseDetail({ caseFile: c }: { caseFile: CaseManifest }) {
	const outcome = outcomeFor(c),
		links = proofLinks(c);
	return (
		<article className="case-detail" aria-labelledby="case-heading">
			<header className="case-heading">
				<div>
					<p className="case-reference">Case {shortHash(c.id)}</p>
					<h2 id="case-heading">{caseTitle(c)}.</h2>
				</div>
				<span className={'status-pill ' + outcome.tone}>{statusLabel(c)}</span>
			</header>
			<div className={'outcome ' + outcome.tone}>
				<div>
					<p className="source-line">{sourceLabel(c)}</p>
					<h3>{outcome.title}</h3>
					<p>{outcome.detail}</p>
				</div>
				<div className="principal">
					<span>{c.payment?.verified ? 'Paid principal' : 'Agreed price'}</span>
					<strong>
						{formatMoney(c.payment?.amount ?? c.agreement.amount)}
						<small>USDC</small>
					</strong>
					<span>Base Sepolia testnet</span>
				</div>
			</div>
			<p className="disclosure" role="note">
				{c.provenance.disclosure}
			</p>
			<ol className="case-stages" aria-label="Case progress">
				{stagesFor(c).map((stage, index) => (
					<li key={stage.label} className={'stage ' + stage.state}>
						<span className="stage-symbol" aria-hidden="true">
							{stage.state === 'complete'
								? '✓'
								: stage.state === 'skipped'
									? '—'
									: index + 1}
						</span>
						<div>
							<strong>{stage.label}</strong>
							<span>{stage.detail}</span>
						</div>
					</li>
				))}
			</ol>
			<div className="evidence-columns">
				<div className="work-column">
					<section className="document-section">
						<h3>The agreed brief</h3>
						<p className="original-text">{c.agreement.brief}</p>
						<details>
							<summary>The quality promise</summary>
							<ul className="rubric-list">
								{c.agreement.rubric.map((criterion) => (
									<li key={criterion.id}>
										<strong>{criterion.id}</strong>
										<p>{criterion.text}</p>
									</li>
								))}
							</ul>
							<p>{c.agreement.refundPolicy}</p>
						</details>
					</section>
					<section className="document-section delivery-section">
						<div className="section-title">
							<h3>What the seller delivered</h3>
							{c.delivery ? (
								<span className="document-tag">Original answer</span>
							) : null}
						</div>
						{c.delivery ? (
							<>
								<p className="original-text">{c.delivery.text}</p>
								<p className="document-hash">
									Delivery commitment{' '}
									<span title={c.delivery.hash}>
										{shortHash(c.delivery.hash)}
									</span>
								</p>
							</>
						) : (
							<p className="muted">No committed answer has been published.</p>
						)}
					</section>
					<section className="document-section">
						<h3>The buyer’s decision</h3>
						{c.buyerClaim ? (
							<>
								<p>{c.buyerClaim.reason}</p>
								{c.buyerClaim.criterionIds.length ? (
									<div className="criterion-tags">
										{c.buyerClaim.criterionIds.map((id) => (
											<span key={id}>{id}</span>
										))}
									</div>
								) : null}
								{c.buyerClaim.quotes.map((quote, index) => (
									<blockquote key={index}>{quote}</blockquote>
								))}
							</>
						) : (
							<p className="muted">The buyer has not published a review.</p>
						)}
					</section>
					{c.sellerDefense ? (
						<section className="document-section">
							<h3>The seller’s response</h3>
							<p className="original-text">{c.sellerDefense}</p>
						</section>
					) : null}
				</div>
				<aside className="ruling-column" aria-label="Court ruling and receipts">
					<section className="ruling-box">
						<div className="section-title">
							<h3>Internet Court ruling</h3>
							<span className="document-tag">
								{c.court?.verified && c.court.status === 'finalized'
									? 'Finalized'
									: c.court?.status === 'accepted'
										? 'Provisional'
										: c.status === 'accepted' ||
												c.refund?.reason === 'non_delivery'
											? 'Not required'
											: 'Pending'}
							</span>
						</div>
						{c.court?.result ? (
							<>
								<p className="ruling-decision">
									{c.court.result.decision === 'REFUND'
										? 'Refund awarded'
										: c.court.result.decision === 'NO_REFUND'
											? 'Purchase upheld'
											: 'Undetermined'}
								</p>
								<p>{c.court.result.reasoning}</p>
								{c.court.result.failedCriteria.length ? (
									<div className="criterion-tags">
										{c.court.result.failedCriteria.map((id) => (
											<span key={id}>{id}</span>
										))}
									</div>
								) : null}
								<p className="muted">
									{c.court.verified && c.court.status === 'finalized'
										? 'Verified final GenLayer state.'
										: 'This result is not a verified final ruling.'}
								</p>
							</>
						) : (
							<p className="muted">
								{c.status === 'accepted'
									? 'The buyer accepted the answer. No court review was required.'
									: c.refund?.reason === 'non_delivery'
										? 'The seller did not deliver within the agreed deadline. This refund does not require a quality ruling.'
										: 'The court’s independent judgment will appear here after submission.'}
							</p>
						)}
					</section>
					<section className="receipts">
						<h3>Follow the receipts</h3>
						<ReceiptLink
							label="x402 payment"
							url={links.payment}
							hash={c.payment?.transactionHash}
						/>
						<ReceiptLink
							label="GenLayer judgment"
							url={links.courtTransaction}
							hash={c.court?.transactionHash}
						/>
						<ReceiptLink
							label="USDC refund"
							url={links.refund}
							hash={c.refund?.transactionHash}
						/>
						<ReceiptLink label="Court contract" url={links.contract} />
						<div className="receipt-row">
							<span>Original payer</span>
							<span title={c.agreement.buyer}>
								{shortHash(c.agreement.buyer)}
							</span>
						</div>
						{c.evidenceHash ? (
							<div className="receipt-row">
								<span>Evidence digest</span>
								<span title={c.evidenceHash}>{shortHash(c.evidenceHash)}</span>
							</div>
						) : null}
						<EvidenceInspector caseId={c.id} />
					</section>
					{c.events.length ? (
						<section className="activity">
							<h3>Case activity</h3>
							<ol>
								{c.events.map((event) => (
									<li key={event.id}>
										<p>{event.label}</p>
										<time dateTime={event.at}>{displayTime(event.at)}</time>
									</li>
								))}
							</ol>
						</section>
					) : null}
				</aside>
			</div>
			<footer className="case-footer">
				<span>Case updated {displayTime(c.updatedAt)}</span>
				<a
					href={'/api/v1/cases/' + c.id}
					target="_blank"
					rel="noopener noreferrer"
				>
					Open case JSON
				</a>
			</footer>
		</article>
	);
}
