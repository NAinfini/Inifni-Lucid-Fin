import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent-classifier.js';

describe('exit-contract/classifyIntent', () => {
  describe('browse intent', () => {
    it.each([
      'what can you do?',
      'What can Commander do',
      'list the tools',
      'list the guides',
      'Show me the menu',
      'How do I start?',
      'help',
      'browse the tools',
      'inventory the guides',
    ])('classifies "%s" as browse', (msg) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'browse' });
    });
  });

  describe('informational intent', () => {
    it.each([
      'What is a style plate?',
      "What's canvas generation?",
      'How does lip sync work?',
      'Explain the preset tracks',
      'Describe continuity-check',
      'Tell me about the audio pipeline',
      'Why does the empty-arg error echo args back?',
      'Can you explain shot templates?',
    ])('classifies "%s" as informational', (msg) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'informational' });
    });
  });

  describe('execution intent with workflow hint', () => {
    it.each([
      ['Create a story-to-video scene from this brief', 'story-to-video'],
      ['Generate a shot list for episode 2', 'shot-list'],
      ['Set up a style plate for this canvas', 'style-plate'],
      ['Write a continuity-check pass over the shots', 'continuity-check'],
      ['Add voice and lip-sync for shot 3', 'audio-production'],
      ['Draft the style transfer across all scenes', 'style-transfer'],
      ['Analyze this image and make character records', 'image-analyze'],
    ])('classifies "%s" as execution with workflow %s', (msg, workflow) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'execution', workflow });
    });
  });

  describe('execution intent without a workflow hint', () => {
    it.each([
      'Create three scene nodes',
      'Build it out',
      'Just make it',
      'Draft something for the opening',
    ])('classifies "%s" as execution (no hint)', (msg) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'execution' });
    });
  });

  describe('mixed / fallback', () => {
    it('treats empty input as mixed (does not throw)', () => {
      expect(classifyIntent({ userMessage: '' })).toEqual({ kind: 'mixed' });
      expect(classifyIntent({ userMessage: '   ' })).toEqual({ kind: 'mixed' });
    });

    it('workflow mention without execution verb is mixed', () => {
      expect(classifyIntent({ userMessage: "I've been thinking about a style plate" }))
        .toEqual({ kind: 'mixed', workflow: 'style-plate' });
    });

    it('random short text falls through to mixed', () => {
      expect(classifyIntent({ userMessage: 'ok cool' })).toEqual({ kind: 'mixed' });
    });
  });

  describe('precedence', () => {
    it('browse wins over execution verbs', () => {
      // "list the tools I can use to create videos" — still browse.
      expect(classifyIntent({ userMessage: 'list the tools I can use to create videos' }))
        .toEqual({ kind: 'browse' });
    });

    it('execution verb beats question phrasing when both are present', () => {
      // Has a verb + a trailing question mark; verb wins because the
      // user explicitly asked for the action.
      expect(classifyIntent({ userMessage: 'Can you create three scene nodes?' }))
        .toEqual({ kind: 'execution' });
    });
  });
});
