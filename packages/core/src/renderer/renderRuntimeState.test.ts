import { describe, expect, it, vi } from 'vitest';
import { RenderRuntimeState } from './renderRuntimeState.js';

describe('RenderRuntimeState', () => {
	describe('initial state', () => {
		it('starts in idle with zero epochs', () => {
			const s = new RenderRuntimeState();
			expect(s.phase).toBe('idle');
			expect(s.frameEpoch).toBe(0);
			expect(s.scrollEpoch).toBe(0);
		});

		it('snapshot returns a plain object copy', () => {
			const s = new RenderRuntimeState();
			const snap = s.snapshot();
			expect(snap).toEqual({ phase: 'idle', frameEpoch: 0, scrollEpoch: 0 });
		});
	});

	describe('legal transitions', () => {
		it('idle -> scroll-pending -> scroll-frame -> post-scroll -> idle', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			expect(s.phase).toBe('scroll-pending');
			s.transitionTo('scroll-frame');
			expect(s.phase).toBe('scroll-frame');
			s.transitionTo('post-scroll');
			expect(s.phase).toBe('post-scroll');
			s.transitionTo('idle');
			expect(s.phase).toBe('idle');
		});

		it('idle -> paint-frame -> idle', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('paint-frame');
			expect(s.phase).toBe('paint-frame');
			s.transitionTo('idle');
			expect(s.phase).toBe('idle');
		});

		it('scroll-pending -> idle (brief scroll ends before any RAF frame fires)', () => {
			// Reproduces: scrollEndTick fires after 3 quiet RAFs while still in scroll-pending
			// because no onScrollFrame ran before the scroll stopped.
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			expect(s.phase).toBe('scroll-pending');
			s.transitionTo('idle');
			expect(s.phase).toBe('idle');
		});

		it('post-scroll -> scroll-pending (new scroll during post-scroll)', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			s.transitionTo('scroll-frame');
			s.transitionTo('post-scroll');
			s.transitionTo('scroll-pending');
			expect(s.phase).toBe('scroll-pending');
		});

		it('any live phase -> destroyed', () => {
			for (const phase of ['idle', 'scroll-pending', 'scroll-frame', 'paint-frame', 'post-scroll'] as const) {
				const s = new RenderRuntimeState();
				if (phase !== 'idle') {
					// advance to the target phase via the happy path
					if (phase === 'scroll-pending') s.transitionTo('scroll-pending');
					if (phase === 'scroll-frame') {
						s.transitionTo('scroll-pending');
						s.transitionTo('scroll-frame');
					}
					if (phase === 'paint-frame') s.transitionTo('paint-frame');
					if (phase === 'post-scroll') {
						s.transitionTo('scroll-pending');
						s.transitionTo('scroll-frame');
						s.transitionTo('post-scroll');
					}
				}
				s.transitionTo('destroyed');
				expect(s.phase).toBe('destroyed');
			}
		});
	});

	describe('invalid transitions', () => {
		it('reports fault and leaves phase unchanged', () => {
			const onFault = vi.fn();
			const s = new RenderRuntimeState(onFault);
			s.transitionTo('scroll-frame'); // idle -> scroll-frame is invalid
			expect(onFault).toHaveBeenCalledOnce();
			expect(s.phase).toBe('idle'); // unchanged
		});

		it('destroyed phase has no outgoing transitions', () => {
			const onFault = vi.fn();
			const s = new RenderRuntimeState(onFault);
			s.transitionTo('destroyed');
			s.transitionTo('idle');
			expect(onFault).toHaveBeenCalledOnce();
			expect(s.phase).toBe('destroyed');
		});
	});

	describe('epoch increments', () => {
		it('scrollEpoch increments on each new scroll session (idle -> scroll-pending)', () => {
			const s = new RenderRuntimeState();
			expect(s.scrollEpoch).toBe(0);
			s.transitionTo('scroll-pending');
			expect(s.scrollEpoch).toBe(1);
		});

		it('scrollEpoch increments again when post-scroll -> scroll-pending', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			s.transitionTo('scroll-frame');
			s.transitionTo('post-scroll');
			const epochAfterFirst = s.scrollEpoch;
			s.transitionTo('scroll-pending');
			expect(s.scrollEpoch).toBe(epochAfterFirst + 1);
		});

		it('scrollEpoch does not increment on scroll-pending -> scroll-pending (invalid, no-op)', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			const epoch = s.scrollEpoch;
			s.transitionTo('scroll-pending'); // invalid, ignored
			expect(s.scrollEpoch).toBe(epoch);
		});

		it('frameEpoch increments on scroll-frame entry', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			s.transitionTo('scroll-frame');
			expect(s.frameEpoch).toBe(1);
		});

		it('frameEpoch increments on paint-frame entry', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('paint-frame');
			expect(s.frameEpoch).toBe(1);
			s.transitionTo('idle');
			s.transitionTo('paint-frame');
			expect(s.frameEpoch).toBe(2);
		});
	});

	describe('derived queries', () => {
		it('isScrolling is true during scroll-pending, scroll-frame, and post-scroll', () => {
			const s = new RenderRuntimeState();
			expect(s.isScrolling()).toBe(false);

			s.transitionTo('scroll-pending');
			expect(s.isScrolling()).toBe(true);

			s.transitionTo('scroll-frame');
			expect(s.isScrolling()).toBe(true);

			s.transitionTo('post-scroll');
			expect(s.isScrolling()).toBe(true);

			s.transitionTo('idle');
			expect(s.isScrolling()).toBe(false);
		});

		it('isScrolling is false during paint-frame and idle', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('paint-frame');
			expect(s.isScrolling()).toBe(false);
		});

		it('isFrameActive is true only during scroll-frame and paint-frame', () => {
			const s = new RenderRuntimeState();
			expect(s.isFrameActive()).toBe(false);

			s.transitionTo('scroll-pending');
			expect(s.isFrameActive()).toBe(false);

			s.transitionTo('scroll-frame');
			expect(s.isFrameActive()).toBe(true);

			s.transitionTo('post-scroll');
			expect(s.isFrameActive()).toBe(false);
		});

		it('canFlushPortals is true only in idle and paint-frame', () => {
			const s = new RenderRuntimeState();
			expect(s.canFlushPortals()).toBe(true); // idle

			s.transitionTo('paint-frame');
			expect(s.canFlushPortals()).toBe(true);

			s.transitionTo('idle');
			s.transitionTo('scroll-pending');
			expect(s.canFlushPortals()).toBe(false);

			s.transitionTo('scroll-frame');
			expect(s.canFlushPortals()).toBe(false);

			s.transitionTo('post-scroll');
			expect(s.canFlushPortals()).toBe(false);
		});

		it('canRunDecoration is true only in idle', () => {
			const s = new RenderRuntimeState();
			expect(s.canRunDecoration()).toBe(true);

			s.transitionTo('paint-frame');
			expect(s.canRunDecoration()).toBe(false);

			s.transitionTo('idle');
			expect(s.canRunDecoration()).toBe(true);

			s.transitionTo('scroll-pending');
			expect(s.canRunDecoration()).toBe(false);
		});
	});

	describe('stale epoch rejection', () => {
		it('isScrollEpochCurrent returns false after a new scroll session begins', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			const captured = s.scrollEpoch;

			s.transitionTo('scroll-frame');
			s.transitionTo('post-scroll');
			s.transitionTo('scroll-pending'); // new session → epoch incremented

			expect(s.isScrollEpochCurrent(captured)).toBe(false);
		});

		it('isScrollEpochCurrent returns true within the same scroll session', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			const captured = s.scrollEpoch;

			s.transitionTo('scroll-frame');
			expect(s.isScrollEpochCurrent(captured)).toBe(true);

			s.transitionTo('post-scroll');
			expect(s.isScrollEpochCurrent(captured)).toBe(true);
		});

		it('isFrameEpochCurrent returns false after next frame begins', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('paint-frame');
			const captured = s.frameEpoch;
			s.transitionTo('idle');
			s.transitionTo('paint-frame');
			expect(s.isFrameEpochCurrent(captured)).toBe(false);
		});
	});

	describe('teardown from every live phase', () => {
		it('transitions to destroyed from idle', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('destroyed');
			expect(s.phase).toBe('destroyed');
		});

		it('transitions to destroyed from scroll-pending', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			s.transitionTo('destroyed');
			expect(s.phase).toBe('destroyed');
		});

		it('transitions to destroyed from scroll-frame', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			s.transitionTo('scroll-frame');
			s.transitionTo('destroyed');
			expect(s.phase).toBe('destroyed');
		});

		it('transitions to destroyed from paint-frame', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('paint-frame');
			s.transitionTo('destroyed');
			expect(s.phase).toBe('destroyed');
		});

		it('transitions to destroyed from post-scroll', () => {
			const s = new RenderRuntimeState();
			s.transitionTo('scroll-pending');
			s.transitionTo('scroll-frame');
			s.transitionTo('post-scroll');
			s.transitionTo('destroyed');
			expect(s.phase).toBe('destroyed');
		});
	});
});
