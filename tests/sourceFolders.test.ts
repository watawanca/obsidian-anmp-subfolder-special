import { describe, it, expect } from 'vitest';
import type { FolderTagRule, RuleCondition } from '../settings/settings';

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function evaluateFolderCondition(
	fileParentPath: string,
	condition: RuleCondition
): boolean {
	if (condition.type !== 'folder') return false;
	const folderPath = (condition.value || '').trim();
	if (!folderPath) return false;

	const normalizedSource = normalizePath(folderPath);

	if (condition.includeSubfolders) {
		return fileParentPath === normalizedSource || fileParentPath.startsWith(normalizedSource + '/');
	}
	return fileParentPath === normalizedSource;
}

describe('folder condition type', () => {
	describe('evaluateFolderCondition', () => {
		it('returns false when value is empty', () => {
			const cond: RuleCondition = { type: 'folder', value: '' };
			expect(evaluateFolderCondition('/notes', cond)).toBe(false);
		});

		it('returns true when file is in exact folder (no subfolders)', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes', includeSubfolders: false };
			expect(evaluateFolderCondition('/notes', cond)).toBe(true);
		});

		it('returns true when file is in exact folder (with subfolders)', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes', includeSubfolders: true };
			expect(evaluateFolderCondition('/notes', cond)).toBe(true);
		});

		it('returns true when file is in subfolder (with subfolders enabled)', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes', includeSubfolders: true };
			expect(evaluateFolderCondition('/notes/subfolder', cond)).toBe(true);
		});

		it('returns true when file is in nested subfolder (with subfolders enabled)', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes', includeSubfolders: true };
			expect(evaluateFolderCondition('/notes/subfolder/nested', cond)).toBe(true);
		});

		it('returns false when file is in subfolder (with subfolders disabled)', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes', includeSubfolders: false };
			expect(evaluateFolderCondition('/notes/subfolder', cond)).toBe(false);
		});

		it('returns false when file is not in folder', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes', includeSubfolders: false };
			expect(evaluateFolderCondition('/other', cond)).toBe(false);
		});

		it('returns false when file is in different root folder', () => {
			const cond: RuleCondition = { type: 'folder', value: '/personal', includeSubfolders: true };
			expect(evaluateFolderCondition('/work/project', cond)).toBe(false);
		});

		it('handles folder paths without leading slash', () => {
			const cond: RuleCondition = { type: 'folder', value: 'notes', includeSubfolders: false };
			expect(evaluateFolderCondition('notes', cond)).toBe(true);
		});

		it('handles folder paths with various formats', () => {
			const cond: RuleCondition = { type: 'folder', value: '/Users/notes', includeSubfolders: false };
			expect(evaluateFolderCondition('/Users/notes', cond)).toBe(true);
		});

		it('returns true when source folder is root (with subfolders)', () => {
			const cond: RuleCondition = { type: 'folder', value: '/', includeSubfolders: true };
			expect(evaluateFolderCondition('/notes', cond)).toBe(true);
		});

		it('includeSubfolders defaults to false when undefined', () => {
			const cond: RuleCondition = { type: 'folder', value: '/notes' };
			expect(evaluateFolderCondition('/notes/subfolder', cond)).toBe(false);
			expect(evaluateFolderCondition('/notes', cond)).toBe(true);
		});
	});

	describe('FolderTagRule with folder condition', () => {
		it('allows folder condition in conditions array', () => {
			const rule: FolderTagRule = {
				folder: '/destination',
				match: 'ALL',
				conditions: [
					{ type: 'folder', value: '/source', includeSubfolders: true },
					{ type: 'tag', value: '#test' },
				],
			};

			expect(rule.conditions).toHaveLength(2);
			expect(rule.conditions[0].type).toBe('folder');
			expect(rule.conditions[0].includeSubfolders).toBe(true);
		});

		it('allows multiple folder conditions', () => {
			const rule: FolderTagRule = {
				folder: '/destination',
				match: 'ANY',
				conditions: [
					{ type: 'folder', value: '/inbox', includeSubfolders: false },
					{ type: 'folder', value: '/drafts', includeSubfolders: true },
				],
			};

			expect(rule.conditions.every((c) => c.type === 'folder')).toBe(true);
		});

		it('works without folder conditions', () => {
			const rule: FolderTagRule = {
				folder: '/destination',
				match: 'ALL',
				conditions: [{ type: 'tag', value: '#test' }],
			};

			expect(rule.conditions.every((c) => c.type !== 'folder')).toBe(true);
		});
	});
});
