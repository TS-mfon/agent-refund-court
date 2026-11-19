export function BrandLogos() {
	return (
		<div className="brand-logos" aria-label="Internet Court, GenLayer and x402">
			<a
				href="https://internetcourt.org"
				target="_blank"
				rel="noopener noreferrer"
			>
				<img
					className="logo-court"
					src="/logos/internet-court.svg"
					width="140"
					height="32"
					alt="Internet Court"
				/>
			</a>
			<span aria-hidden="true">+</span>
			<a href="https://genlayer.com" target="_blank" rel="noopener noreferrer">
				<img
					className="logo-genlayer"
					src="/logos/genlayer.svg"
					width="116"
					height="30"
					alt="GenLayer"
				/>
			</a>
			<span aria-hidden="true">+</span>
			<a href="https://x402.org" target="_blank" rel="noopener noreferrer">
				<img
					className="logo-x402"
					src="/logos/x402.svg"
					width="62"
					height="26"
					alt="x402"
				/>
			</a>
		</div>
	);
}
export function CourtMark() {
	return (
		<svg
			viewBox="0 0 56 56"
			fill="none"
			aria-hidden="true"
			className="court-mark"
		>
			<circle cx="28" cy="28" r="25" stroke="currentColor" strokeWidth="2" />
			<path
				d="M15 22L28 15L41 22M17 24H39M19 26V36M28 26V36M37 26V36M15 40H41"
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
