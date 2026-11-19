import { useEffect, useState } from 'react';
import { BrandLogos, CourtMark } from './brand.js';
import { CaseDetail } from './case-detail.js';
import { useCases } from './use-cases.js';
import { initialSelection } from './presentation.js';
import {
	shortHash,
	sourceLabel,
	statusLabel,
	displayTime,
	formatMoney,
	safeExternalUrl,
} from './model.js';

const REPOSITORY = 'https://github.com/TS-mfon/agent-refund-court';
function Reproduce() {
	const [copied, setCopied] = useState(false);
	const origin =
		typeof window === 'undefined'
			? 'https://agent-refund-court.vercel.app'
			: window.location.port === '5173'
				? 'http://127.0.0.1:3001'
				: window.location.origin;
	const command = 'npm run demo -- --origin ' + origin + ' --scenario bad';
	async function copy() {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}
	return (
		<section id="reproduce" className="reproduce">
			<div>
				<h2>Put your agent on the buyer’s side.</h2>
				<p>
					The skill runs the purchase and buyer review. This page follows the
					published case as the court and seller worker advance it.
				</p>
				<a
					href={REPOSITORY + '/blob/main/skills/agent-refund-court/SKILL.md'}
					target="_blank"
					rel="noopener noreferrer"
				>
					Read the agent skill
				</a>
			</div>
			<div className="run-instructions">
				<p>From the configured repository</p>
				<div className="command">
					<code>{command}</code>
					<button
						type="button"
						className="copy-button"
						onClick={() => {
							void copy();
						}}
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
				</div>
				<p>
					Use the setup guide to supply a demo access token and a Base Sepolia
					buyer wallet. The buyer keeps its signing key locally.
				</p>
				<a
					href={REPOSITORY + '/blob/main/docs/reproduction.md'}
					target="_blank"
					rel="noopener noreferrer"
				>
					Setup and reproduction guide
				</a>
			</div>
		</section>
	);
}
export function App() {
	const [selectedId, setSelectedId] = useState<string | null>(() =>
		typeof window === 'undefined'
			? null
			: initialSelection(window.location.search),
	);
	const [polling, setPolling] = useState(true);
	const { cases, current, service, loading, error, checkedAt, refresh } =
		useCases(selectedId, polling);
	useEffect(() => {
		const update = () =>
			setSelectedId(initialSelection(window.location.search));
		window.addEventListener('popstate', update);
		return () => window.removeEventListener('popstate', update);
	}, []);
	function select(id: string) {
		setSelectedId(id);
		const url = new URL(window.location.href);
		url.searchParams.set('case', id);
		window.history.pushState(null, '', url.pathname + url.search);
	}
	const repository = safeExternalUrl(service?.repository) ?? REPOSITORY;
	return (
		<>
			<a className="skip-link" href="#cases">
				Skip to cases
			</a>
			<header className="site-header">
				<a
					className="app-identity"
					href="/"
					aria-label="Agent Refund Court home"
				>
					<CourtMark />
					<span>Agent Refund Court</span>
				</a>
				<nav aria-label="Main navigation">
					<a href="#cases">Cases</a>
					<a href="#reproduce">Run with an agent</a>
					<a href={repository} target="_blank" rel="noopener noreferrer">
						Source code
					</a>
				</nav>
			</header>
			<main className="site-main">
				<section className="intro">
					<div className="intro-copy">
						<h1>A bad answer can become a fair outcome.</h1>
						<p>
							An agent buys a launch plan through x402. Internet Court judges a
							quality dispute on GenLayer. A finalized refund ruling sends the
							paid USDC back to the buyer.
						</p>
					</div>
					<div className="intro-partners">
						<BrandLogos />
						<p>A small, reproducible proof for agent commerce.</p>
						<span className="testnet-badge">
							Base Sepolia + GenLayer Studio
						</span>
					</div>
				</section>
				<section id="cases" className="viewer" aria-label="Published cases">
					<div className="viewer-toolbar">
						<div>
							<h2>Follow the case</h2>
							<p>
								{checkedAt
									? 'Checked ' + displayTime(checkedAt)
									: 'Reading published evidence…'}
							</p>
						</div>
						<div className="viewer-controls">
							<label className="polling-label">
								<input
									type="checkbox"
									checked={polling}
									onChange={(event) => setPolling(event.target.checked)}
								/>
								<span>Auto-refresh</span>
							</label>
							<button
								className="button secondary"
								type="button"
								disabled={loading}
								onClick={refresh}
							>
								{loading ? 'Checking…' : 'Refresh'}
							</button>
						</div>
					</div>
					{error ? (
						<div className="service-error" role="alert">
							<strong>The case service could not be read.</strong>
							<p>{error}</p>
							{cases.length ? (
								<p>
									Previously loaded evidence is still visible. Its status may
									have changed.
								</p>
							) : null}
							<button
								className="button secondary"
								onClick={refresh}
								type="button"
							>
								Retry
							</button>
						</div>
					) : null}
					{loading && !cases.length ? (
						<div className="loading-case" role="status">
							<span className="loading-ring" aria-hidden="true" />
							<p>Loading the case and its receipts…</p>
						</div>
					) : null}
					{!loading && !error && !cases.length ? (
						<div className="empty-case">
							<CourtMark />
							<h3>No case has been published yet.</h3>
							<p>
								Run the agent skill to create a testnet purchase. Payment,
								ruling, and refund receipts will appear here as they are
								verified.
							</p>
							<a className="button primary" href="#reproduce">
								Run with an agent
							</a>
						</div>
					) : null}
					{cases.length ? (
						<div className="case-workspace">
							<aside className="case-list" aria-label="Choose a published case">
								<div className="list-title">
									<h3>Published cases</h3>
									<span>{cases.length}</span>
								</div>
								{cases.map((c) => (
									<button
										key={c.id}
										type="button"
										className={
											'case-option ' + (current?.id === c.id ? 'selected' : '')
										}
										aria-pressed={current?.id === c.id}
										onClick={() => select(c.id)}
									>
										<strong>Launch plan</strong>
										<span>{shortHash(c.id)}</span>
										<span className="case-option-status">{statusLabel(c)}</span>
										<small>{sourceLabel(c)}</small>
									</button>
								))}
								<div className="service-summary">
									<h3>The purchase</h3>
									<p>
										{service
											? formatMoney(service.priceBaseUnits) + ' USDC'
											: 'Price in each agreement'}
									</p>
									<p>
										A tailored plan for a solo builder with five hours and no
										advertising budget.
									</p>
									<p className="muted">
										{service
											? service.capabilities.purchase
												? 'Agent purchases enabled'
												: 'Purchase service unavailable'
											: 'Service metadata unavailable'}
									</p>
								</div>
							</aside>
							{current ? (
								<CaseDetail key={current.id} caseFile={current} />
							) : (
								<div className="empty-case">
									<h3>The selected case is unavailable.</h3>
									<p>Choose a published case to inspect its evidence.</p>
								</div>
							)}
						</div>
					) : null}
				</section>
				<Reproduce />
				<section className="trust-note">
					<h2>The court judges. The seller pays.</h2>
					<p>
						GenLayer independently evaluates the bounded brief, answer, and
						quality rubric. A trusted registrar admits payment facts; the
						seller’s worker applies the finalized ruling. This demo demonstrates
						a cooperative seller returning testnet USDC.
					</p>
				</section>
			</main>
			<footer className="site-footer">
				<span>Built for the Internet Court Builders Working Group</span>
				<a href={repository} target="_blank" rel="noopener noreferrer">
					Public code and receipts
				</a>
			</footer>
		</>
	);
}
