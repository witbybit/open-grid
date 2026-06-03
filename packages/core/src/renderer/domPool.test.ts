// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

import { DOMPool } from './domPool.js';

describe('DOMPool', () => {
	it('should pre-warm the pool with initial capacity', () => {
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			const el = document.createElement('div');
			el.className = 'test-node';
			return el;
		};

		const pool = new DOMPool(factory, 10);
		expect(factoryCount).toBe(10);
		expect(pool.availableCount).toBe(10);
		expect(pool.totalCount).toBe(10);
	});

	it('should acquire nodes from available pool or grow when exhausted', () => {
		let factoryCount = 0;
		const factory = () => {
			factoryCount++;
			return document.createElement('div');
		};

		const pool = new DOMPool(factory, 5);

		// Acquire all pre-warmed nodes
		const nodes: HTMLDivElement[] = [];
		for (let i = 0; i < 5; i++) {
			nodes.push(pool.acquire());
		}

		expect(pool.availableCount).toBe(0);
		expect(factoryCount).toBe(5);

		// Acquire another node (should grow)
		const extraNode = pool.acquire();
		expect(factoryCount).toBe(6);
		expect(pool.totalCount).toBe(6);
		expect(pool.availableCount).toBe(0);
	});

	it('should clean and release elements back to the pool', () => {
		const factory = () => document.createElement('div');
		const pool = new DOMPool(factory, 2);

		const node = pool.acquire();
		node.textContent = 'hello world';
		node.className = 'active-cell custom-class';
		node.style.transform = 'translate3d(10px, 0px, 0px)';
		node.style.color = 'red';
		node.dataset.rowIndex = '5';
		node.dataset.colField = 'name';

		pool.release(node);

		expect(pool.availableCount).toBe(2);
		expect(node.textContent).toBe('');
		expect(node.className).toBe('');
		expect(node.style.transform).toBe('');
		expect(node.style.color).toBe('');
		expect(node.dataset.rowIndex).toBeUndefined();
		expect(node.dataset.colField).toBeUndefined();
	});

	it('hot releases without deep cleanup for scroll recycling', () => {
		const factory = () => document.createElement('div');
		const pool = new DOMPool(factory, 1);

		const node = pool.acquire();
		node.textContent = 'kept until bind';
		node.className = 'og-cell custom';
		node.style.transform = 'translate3d(10px, 0, 0)';
		node.dataset.colField = 'name';

		pool.releaseHot(node);

		expect(pool.availableCount).toBe(1);
		expect(pool.hotReleases).toBe(1);
		expect(node.textContent).toBe('kept until bind');
		expect(node.className).toBe('og-cell custom');
		expect(node.style.transform).toBe('translate3d(10px, 0, 0)');
		expect(node.dataset.colField).toBe('name');
	});

	it('should clear all nodes and references when clear is called', () => {
		const factory = () => document.createElement('div');
		const pool = new DOMPool(factory, 5);

		expect(pool.availableCount).toBe(5);
		pool.clear();
		expect(pool.availableCount).toBe(0);
	});
});
