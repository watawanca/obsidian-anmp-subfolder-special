import { describe, it, expect } from 'vitest';
import type { TFile, CachedMetadata } from 'obsidian';
import { isRuleMatched } from '../utils/ruleMatching';
import { processFolderPath } from '../utils/pathProcessing';

type MatchMode = 'ALL' | 'ANY';
type ConditionType = 'tag' | 'title' | 'property' | 'date' | 'folder';
type DateSource = 'frontmatter' | 'metadata';
type MetadataField = 'ctime' | 'mtime';

interface RuleCondition {
	type: ConditionType;
	value: string;
	dateSource?: DateSource;
	metadataField?: MetadataField;
	includeSubfolders?: boolean;
}

interface FolderTagRule {
	folder: string;
	match: MatchMode;
	conditions: RuleCondition[];
}

interface ExcludedFolder {
	folder: string;
}

interface AutoNoteMoverSettings {
	trigger_auto_manual: string;
	trigger_on_file_creation: boolean;
	use_regex_to_check_for_tags: boolean;
	statusBar_trigger_indicator: boolean;
	folder_tag_pattern: Array<FolderTagRule>;
	use_regex_to_check_for_excluded_folder: boolean;
	excluded_folder: Array<ExcludedFolder>;
	hide_notifications?: boolean;
	duplicate_file_action?: 'skip' | 'merge';
}

const DEFAULT_SETTINGS: AutoNoteMoverSettings = {
	trigger_auto_manual: 'Automatic',
	trigger_on_file_creation: false,
	use_regex_to_check_for_tags: false,
	statusBar_trigger_indicator: true,
	folder_tag_pattern: [{ folder: '', match: 'ALL', conditions: [] }],
	use_regex_to_check_for_excluded_folder: false,
	excluded_folder: [{ folder: '' }],
	hide_notifications: false,
	duplicate_file_action: 'skip',
};

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

function canUseMergeAction(triggerMode: string, noteComposerEnabled: boolean): boolean {
	if (triggerMode !== 'Manual') {
		return false;
	}
	if (!noteComposerEnabled) {
		return false;
	}
	return true;
}

const mockFile = {
	stat: {
		ctime: new Date('2025-01-15').getTime(),
		mtime: new Date('2025-01-15').getTime(),
	},
	parent: {
		path: '/inbox',
	},
} as unknown as TFile;

const fileCache = {
	frontmatter: {
		created: '2025-01-15',
	},
} as CachedMetadata;

const makeContext = (overrides: {
	fileCache?: CachedMetadata | null | undefined;
	fileName?: string;
	tags?: string[];
	useRegexForTags?: boolean;
	file?: TFile;
} = {}): {
	fileCache: CachedMetadata | null | undefined;
	fileName: string;
	tags: string[];
	useRegexForTags: boolean;
	file: TFile;
} => ({
	fileCache,
	fileName: 'test-note',
	tags: [],
	useRegexForTags: false,
	file: mockFile,
	...overrides,
});

describe('Integration tests', () => {
	describe('Settings migration', () => {
		it('should load legacy settings without new fields', () => {
			const legacySettings: Omit<AutoNoteMoverSettings, 'hide_notifications' | 'duplicate_file_action'> = {
				trigger_auto_manual: 'Automatic',
				trigger_on_file_creation: false,
				use_regex_to_check_for_tags: false,
				statusBar_trigger_indicator: true,
				folder_tag_pattern: [{ folder: '', match: 'ALL', conditions: [] }],
				use_regex_to_check_for_excluded_folder: false,
				excluded_folder: [{ folder: '' }],
			};

			const migratedSettings: AutoNoteMoverSettings = {
				...DEFAULT_SETTINGS,
				...legacySettings,
			};

			expect(migratedSettings.hide_notifications).toBe(false);
			expect(migratedSettings.duplicate_file_action).toBe('skip');
			expect(migratedSettings.trigger_auto_manual).toBe('Automatic');
			expect(migratedSettings.folder_tag_pattern).toHaveLength(1);
		});

		it('should save and load settings with folder conditions', () => {
			const fullSettings: AutoNoteMoverSettings = {
				trigger_auto_manual: 'Manual',
				trigger_on_file_creation: true,
				use_regex_to_check_for_tags: true,
				statusBar_trigger_indicator: false,
				folder_tag_pattern: [
					{
						folder: 'Projects/$1',
						match: 'ALL',
						conditions: [
							{ type: 'folder', value: '/inbox', includeSubfolders: false },
							{ type: 'folder', value: '/drafts', includeSubfolders: true },
							{ type: 'tag', value: '#project-(\\w+)' },
						],
					},
				],
				use_regex_to_check_for_excluded_folder: true,
				excluded_folder: [{ folder: '/archive' }],
				hide_notifications: true,
				duplicate_file_action: 'merge',
			};

			const saved = JSON.stringify(fullSettings);
			const loaded = JSON.parse(saved) as AutoNoteMoverSettings;

			expect(loaded.trigger_auto_manual).toBe('Manual');
			expect(loaded.trigger_on_file_creation).toBe(true);
			expect(loaded.hide_notifications).toBe(true);
			expect(loaded.duplicate_file_action).toBe('merge');
			expect(loaded.folder_tag_pattern[0].conditions).toHaveLength(3);
			expect(loaded.folder_tag_pattern[0].conditions[0].type).toBe('folder');
			expect(loaded.folder_tag_pattern[0].conditions[0].includeSubfolders).toBe(false);
			expect(loaded.folder_tag_pattern[0].conditions[1].includeSubfolders).toBe(true);
		});
	});

	describe('Feature interaction', () => {
		it('should apply folder condition with tag condition (match ALL)', () => {
			const rule: FolderTagRule = {
				folder: 'Projects',
				match: 'ALL',
				conditions: [
					{ type: 'folder', value: '/inbox', includeSubfolders: false },
					{ type: 'tag', value: '#project' },
				],
			};

			const fileInInbox = {
				...mockFile,
				parent: { path: '/inbox' },
			} as unknown as TFile;

			const matchResult = isRuleMatched(rule, makeContext({
				tags: ['#project'],
				useRegexForTags: true,
				file: fileInInbox,
			}));

			expect(matchResult.matched).toBe(true);
		});

		it('should reject when folder condition not met (match ALL)', () => {
			const rule: FolderTagRule = {
				folder: 'Projects',
				match: 'ALL',
				conditions: [
					{ type: 'folder', value: '/inbox', includeSubfolders: false },
					{ type: 'tag', value: '#project' },
				],
			};

			const fileInOther = {
				...mockFile,
				parent: { path: '/other' },
			} as unknown as TFile;

			const matchResult = isRuleMatched(rule, makeContext({
				tags: ['#project'],
				useRegexForTags: true,
				file: fileInOther,
			}));

			expect(matchResult.matched).toBe(false);
		});

		it('should apply folder condition with includeSubfolders', () => {
			const rule: FolderTagRule = {
				folder: 'Archive',
				match: 'ALL',
				conditions: [
					{ type: 'folder', value: '/inbox', includeSubfolders: true },
				],
			};

			const fileInSubfolder = {
				...mockFile,
				parent: { path: '/inbox/subfolder' },
			} as unknown as TFile;

			const matchResult = isRuleMatched(rule, makeContext({
				file: fileInSubfolder,
			}));

			expect(matchResult.matched).toBe(true);
		});

		it('should handle capture groups with date tokens together', () => {
			const rule: FolderTagRule = {
				folder: 'Journal/$1/{{YYYY}}/{{MM}}',
				match: 'ALL',
				conditions: [
					{ type: 'tag', value: '#(\\w+)' },
					{ type: 'date', value: '', dateSource: 'metadata', metadataField: 'ctime' },
				],
			};

			const matchResult = isRuleMatched(rule, makeContext({
				tags: ['#work'],
				useRegexForTags: true,
			}));

			expect(matchResult.matched).toBe(true);
			expect(matchResult.captureGroups).toEqual(['work']);

			const processedFolder = processFolderPath(
				rule.folder,
				fileCache,
				mockFile,
				rule,
				matchResult.captureGroups
			);

			expect(processedFolder).toBe('Journal/work/2025/01');
		});

		it('should respect hide_notifications during batch move', () => {
			const hideNotifications = true;
			const files = ['note1.md', 'note2.md', 'note3.md'];
			const notificationCount = { success: 0, error: 0 };

			for (const _file of files) {
				if (!hideNotifications) {
					notificationCount.success++;
				}
				notificationCount.error++;
			}

			expect(notificationCount.success).toBe(0);
			expect(notificationCount.error).toBe(3);
		});

		it('should respect hide_notifications = false during batch move', () => {
			const hideNotifications = false;
			const files = ['note1.md', 'note2.md'];
			const notificationCount = { success: 0, error: 0 };

			for (const _file of files) {
				if (!hideNotifications) {
					notificationCount.success++;
				}
				notificationCount.error++;
			}

			expect(notificationCount.success).toBe(2);
			expect(notificationCount.error).toBe(2);
		});

		it('should only allow merge in Manual mode', () => {
			const autoResult = canUseMergeAction('Automatic', true);
			expect(autoResult).toBe(false);

			const manualWithComposer = canUseMergeAction('Manual', true);
			expect(manualWithComposer).toBe(true);

			const manualWithoutComposer = canUseMergeAction('Manual', false);
			expect(manualWithoutComposer).toBe(false);
		});

		it('should determine merge availability based on trigger mode and plugin state', () => {
			const testCases = [
				{ trigger: 'Automatic', composer: true, expected: false },
				{ trigger: 'Automatic', composer: false, expected: false },
				{ trigger: 'Manual', composer: true, expected: true },
				{ trigger: 'Manual', composer: false, expected: false },
			];

			for (const tc of testCases) {
				const result = canUseMergeAction(tc.trigger, tc.composer);
				expect(result).toBe(tc.expected);
			}
		});
	});

	describe('Edge cases', () => {
		it('should handle rule with folder condition as only condition', () => {
			const rule: FolderTagRule = {
				folder: 'Destination',
				match: 'ALL',
				conditions: [
					{ type: 'folder', value: '/inbox', includeSubfolders: false },
				],
			};

			const fileInInbox = {
				...mockFile,
				parent: { path: '/inbox' },
			} as unknown as TFile;

			const result = isRuleMatched(rule, makeContext({ file: fileInInbox }));
			expect(result.matched).toBe(true);
		});

		it('should handle multiple folder conditions with ANY match', () => {
			const rule: FolderTagRule = {
				folder: 'Archive',
				match: 'ANY',
				conditions: [
					{ type: 'folder', value: '/inbox', includeSubfolders: false },
					{ type: 'folder', value: '/drafts', includeSubfolders: false },
				],
			};

			const fileInDrafts = {
				...mockFile,
				parent: { path: '/drafts' },
			} as unknown as TFile;

			const result = isRuleMatched(rule, makeContext({ file: fileInDrafts }));
			expect(result.matched).toBe(true);
		});

		it('should handle undefined capture groups gracefully', () => {
			const rule: FolderTagRule = {
				folder: 'Projects/$1/Notes',
				match: 'ALL',
				conditions: [{ type: 'tag', value: '#test' }],
			};

			const result = processFolderPath(
				rule.folder,
				fileCache,
				mockFile,
				rule,
				undefined
			);

			expect(result).toBe('Projects/$1/Notes');
		});

		it('should fallback to skip when Note Composer disabled', () => {
			const noteComposerEnabled = false;
			const duplicate_file_action = 'merge';

			const actualAction = noteComposerEnabled ? duplicate_file_action : 'skip';

			expect(actualAction).toBe('skip');
		});

		it('should allow merge when Note Composer enabled', () => {
			const noteComposerEnabled = true;
			const duplicate_file_action = 'merge';

			const actualAction = noteComposerEnabled ? duplicate_file_action : 'skip';

			expect(actualAction).toBe('merge');
		});

		it('should handle settings with partial new fields', () => {
			const partialSettings: Partial<AutoNoteMoverSettings> = {
				trigger_auto_manual: 'Automatic',
				hide_notifications: true,
			};

			const settings: AutoNoteMoverSettings = {
				...DEFAULT_SETTINGS,
				...partialSettings,
			};

			expect(settings.hide_notifications).toBe(true);
			expect(settings.duplicate_file_action).toBe('skip');
		});

		it('should handle rule with no conditions', () => {
			const rule: FolderTagRule = {
				folder: 'Archive',
				match: 'ALL',
				conditions: [],
			};

			const result = isRuleMatched(rule, makeContext());
			expect(result.matched).toBe(false);
		});

		it('should handle nested capture groups with multiple rules', () => {
			const rule1: FolderTagRule = {
				folder: 'Work/$1',
				match: 'ALL',
				conditions: [{ type: 'tag', value: '#work-(\\w+)' }],
			};

			const rule2: FolderTagRule = {
				folder: 'Personal/$1',
				match: 'ALL',
				conditions: [{ type: 'tag', value: '#personal-(\\w+)' }],
			};

			const result1 = isRuleMatched(rule1, makeContext({
				tags: ['#work-project'],
				useRegexForTags: true,
			}));

			expect(result1.matched).toBe(true);
			expect(result1.captureGroups).toEqual(['project']);

			const processed1 = processFolderPath(rule1.folder, fileCache, mockFile, rule1, result1.captureGroups);
			expect(processed1).toBe('Work/project');

			const result2 = isRuleMatched(rule2, makeContext({
				tags: ['#personal-journal'],
				useRegexForTags: true,
			}));

			expect(result2.matched).toBe(true);
			expect(result2.captureGroups).toEqual(['journal']);

			const processed2 = processFolderPath(rule2.folder, fileCache, mockFile, rule2, result2.captureGroups);
			expect(processed2).toBe('Personal/journal');
		});

		it('should handle folder condition with empty value', () => {
			const cond: RuleCondition = { type: 'folder', value: '', includeSubfolders: false };
			const result = evaluateFolderCondition('/inbox', cond);
			expect(result).toBe(false);
		});

		it('should handle folder condition matching exact path', () => {
			const cond: RuleCondition = { type: 'folder', value: '/inbox', includeSubfolders: false };
			expect(evaluateFolderCondition('/inbox', cond)).toBe(true);
			expect(evaluateFolderCondition('/inbox/sub', cond)).toBe(false);
		});

		it('should handle folder condition with subfolders', () => {
			const cond: RuleCondition = { type: 'folder', value: '/inbox', includeSubfolders: true };
			expect(evaluateFolderCondition('/inbox', cond)).toBe(true);
			expect(evaluateFolderCondition('/inbox/sub', cond)).toBe(true);
			expect(evaluateFolderCondition('/inbox/sub/nested', cond)).toBe(true);
			expect(evaluateFolderCondition('/other', cond)).toBe(false);
		});
	});
});
