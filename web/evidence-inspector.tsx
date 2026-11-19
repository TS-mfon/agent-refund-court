import { useEffect, useState } from 'react';
import { fetchEvidence } from './api.js';

export function EvidenceInspector({ caseId }: { caseId: string }) {
	const [state, setState] = useState<{
		id: string;
		loading: boolean;
		json: string | null;
		error: string | null;
	}>({ id: caseId, loading: false, json: null, error: null });
	const [open, setOpen] = useState(false);
	useEffect(() => {
		setOpen(false);
		setState({ id: caseId, loading: false, json: null, error: null });
	}, [caseId]);
	useEffect(() => {
		if (!open) return;
		let active = true;
		const controller = new AbortController();
		setState({ id: caseId, loading: true, json: null, error: null });
		fetchEvidence(caseId, controller.signal)
			.then((evidence) => {
				const json = JSON.stringify(evidence, null, 2);
				if (json.length > 65536)
					throw new Error(
						'The published evidence exceeds the viewer’s size limit. Download the original JSON.',
					);
				if (active) setState({ id: caseId, loading: false, json, error: null });
			})
			.catch((issue) => {
				if (active)
					setState({
						id: caseId,
						loading: false,
						json: null,
						error:
							issue instanceof Error
								? issue.message
								: 'Evidence could not be loaded.',
					});
			});
		return () => {
			active = false;
			controller.abort();
		};
	}, [caseId, open]);
	return (
		<div className="evidence-inspector">
			<button
				className="button secondary"
				type="button"
				aria-expanded={open}
				aria-controls="evidence-json"
				onClick={() => setOpen((value) => !value)}
			>
				{open ? 'Hide sealed evidence' : 'Inspect sealed evidence'}
			</button>
			{open ? (
				<div id="evidence-json" className="evidence-json">
					{state.id === caseId && state.loading ? (
						<p role="status">Loading original evidence…</p>
					) : null}
					{state.id === caseId && state.error ? (
						<p role="alert">{state.error}</p>
					) : null}
					{state.id === caseId && state.json ? <pre>{state.json}</pre> : null}
					<a
						href={'/api/v1/cases/' + caseId + '/evidence'}
						target="_blank"
						rel="noopener noreferrer"
					>
						Open original evidence JSON
					</a>
				</div>
			) : null}
		</div>
	);
}
