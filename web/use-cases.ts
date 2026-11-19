import { useCallback, useEffect, useState } from 'react';
import type { CaseManifest } from '../src/domain/schema.js';
import { fetchCase, fetchCases, fetchService, type Service } from './api.js';

export function useCases(selectedId: string | null, polling: boolean) {
	const [cases, setCases] = useState<CaseManifest[]>([]);
	const [selected, setSelected] = useState<CaseManifest | null>(null);
	const [service, setService] = useState<Service | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [checkedAt, setCheckedAt] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const refresh = useCallback(() => setRefreshKey((v) => v + 1), []);
	useEffect(() => {
		const controller = new AbortController();
		fetchService(controller.signal)
			.then(setService)
			.catch(() => {
				/* Case viewing remains available without service metadata. */
			});
		return () => controller.abort();
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		let active = true,
			busy = false;
		async function load() {
			if (busy) return;
			busy = true;
			setLoading(true);
			try {
				const [list, detail] = await Promise.all([
					fetchCases(controller.signal),
					selectedId
						? fetchCase(selectedId, controller.signal)
						: Promise.resolve(null),
				]);
				if (!active) return;
				setCases(list);
				setSelected(detail);
				setError(null);
				setCheckedAt(new Date().toISOString());
			} catch (issue) {
				if (active)
					setError(
						issue instanceof Error && issue.name !== 'AbortError'
							? issue.message
							: 'The case service could not be reached. Retry to check again.',
					);
			} finally {
				if (active) setLoading(false);
				busy = false;
			}
		}
		void load();
		const timer = polling
			? setInterval(() => {
					if (document.visibilityState === 'visible') void load();
				}, 8000)
			: null;
		return () => {
			active = false;
			controller.abort();
			if (timer) clearInterval(timer);
		};
	}, [selectedId, polling, refreshKey]);
	const current = selectedId
		? selected?.id.toLowerCase() === selectedId.toLowerCase()
			? selected
			: (cases.find((c) => c.id.toLowerCase() === selectedId.toLowerCase()) ?? null)
		: (cases[0] ?? null);
	return { cases, current, service, loading, error, checkedAt, refresh };
}
