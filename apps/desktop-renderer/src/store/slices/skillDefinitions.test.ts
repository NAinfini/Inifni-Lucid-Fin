// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { COMMANDER_GUIDE_LIMITS } from '@lucid-fin/contracts';
import {
  addCustomSkill,
  selectActiveSkills,
  setCustomContent,
  skillDefinitionsSlice,
  type SkillDefinition,
  type SkillDefinitionsState,
} from './skillDefinitions.js';

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 'guide-1',
    name: 'Guide',
    category: 'skill',
    defaultContent: 'default',
    customContent: null,
    builtIn: true,
    source: 'taskSkill',
    createdAt: 0,
    ...overrides,
  };
}

describe('skillDefinitions guide budgets', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rejects oversized edits and custom guides at the reducer boundary', () => {
    const initial: SkillDefinitionsState = { skills: [makeSkill()] };
    const oversizedTaskSkill = 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxTaskSkillChars + 1);
    const afterEdit = skillDefinitionsSlice.reducer(
      initial,
      setCustomContent({ id: 'guide-1', content: oversizedTaskSkill }),
    );
    expect(afterEdit.skills[0]?.customContent).toBeNull();

    const oversizedUserGuide = 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxUserGuideChars + 1);
    const afterAdd = skillDefinitionsSlice.reducer(
      afterEdit,
      addCustomSkill({ name: 'Too large', category: 'skill', content: oversizedUserGuide }),
    );
    expect(afterAdd.skills).toHaveLength(1);
  });

  it('ships short auto-injection content separately from the full guide', () => {
    const guide = makeSkill({
      defaultContent: 'full task guide',
      autoInject: true,
      autoInjectContent: 'short runtime kernel',
    });

    expect(selectActiveSkills([guide])).toEqual([
      expect.objectContaining({
        id: 'guide-1',
        content: 'full task guide',
        autoInject: true,
        autoInjectContent: 'short runtime kernel',
      }),
    ]);
  });

  it('does not send legacy oversized guide content to Commander', () => {
    const oversized = makeSkill({
      defaultContent: 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxTaskSkillChars + 1),
    });

    expect(selectActiveSkills([oversized])).toEqual([]);
  });

  it('keeps every bundled guide inside its source budget', () => {
    const skills = skillDefinitionsSlice.getInitialState().skills;

    expect(selectActiveSkills(skills)).toHaveLength(skills.length);
  });

  it('keeps built-in workflow guides available on demand without auto-injecting them', () => {
    const guides = selectActiveSkills(skillDefinitionsSlice.getInitialState().skills).filter((guide) =>
      ['prompt-structure', 'task-guide-story-to-video', 'task-guide-style-plate'].includes(guide.id),
    );

    expect(guides).toHaveLength(3);
    expect(guides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prompt-structure', content: expect.any(String) }),
        expect.objectContaining({ id: 'task-guide-story-to-video', content: expect.any(String) }),
        expect.objectContaining({ id: 'task-guide-style-plate', content: expect.any(String) }),
      ]),
    );
    expect(guides.every((guide) => guide.autoInject === undefined)).toBe(true);
    expect(guides.every((guide) => guide.autoInjectContent === undefined)).toBe(true);
  });
});
