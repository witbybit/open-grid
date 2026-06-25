/** Placeholder for panels that are not yet fully implemented. */
export function StubPanel({ title }: { title: string }) {
	return (
		<div style={{ padding: '16px', textAlign: 'center', color: 'var(--og-cell-text-muted, #888)', fontSize: '13px' }}>
			<div style={{ fontSize: '24px', marginBottom: '8px' }}>🚧</div>
			<div>{title}</div>
			<div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>Coming soon</div>
		</div>
	);
}
