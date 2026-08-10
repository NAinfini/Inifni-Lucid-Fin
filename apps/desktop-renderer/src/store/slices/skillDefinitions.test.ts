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
    source: 'workflowSkill',
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
    const oversizedWorkflowSkill = 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxWorkflowSkillChars + 1);
    const afterEdit = skillDefinitionsSlice.reducer(
      initial,
      setCustomContent({ id: 'guide-1', content: oversizedWorkflowSkill }),
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
      defaultContent: 'full workflow guide',
      autoInject: true,
      autoInjectContent: 'short runtime kernel',
    });

    expect(selectActiveSkills([guide])).toEqual([
      expect.objectContaining({
        id: 'guide-1',
        content: 'full workflow guide',
        autoInject: true,
        autoInjectContent: 'short runtime kernel',
      }),
    ]);
  });

  it('does not send legacy oversized guide content to Commander', () => {
    const oversized = makeSkill({
      defaultContent: 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxWorkflowSkillChars + 1),
    });

    expect(selectActiveSkills([oversized])).toEqual([]);
  });

  it('keeps every bundled guide and automatic summary inside its source budget', () => {
    const skills = skillDefinitionsSlice.getInitialState().skills;

    expect(selectActiveSkills(skills)).toHaveLength(skills.length);
    for (const skill of skills) {
      if (skill.autoInjectContent) {
        expect(skill.autoInjectContent.length).toBeLessThanOrEqual(
          COMMANDER_GUIDE_LIMITS.maxAutoInjectCharsPerGuide,
        );
      }
    }
  });
});
