import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent-classifier.js';

describe('exit-contract/classifyIntent', () => {
  describe('informational intent (browse phrases only)', () => {
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
    ])('classifies "%s" as informational (browse)', (msg) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'informational' });
    });
  });

  describe('zh-CN browse phrases', () => {
    it.each(['你能做什么', '列出所有工具', '展示菜单', '怎么开始', '帮助'])(
      'classifies "%s" as informational',
      (msg) => {
        expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'informational' });
      },
    );
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

  describe('zh-CN workflow hints', () => {
    it.each([
      ['帮我生成一个镜头列表', 'shot-list'],
      ['剧本到视频', 'story-to-video'],
      ['风格板设置', 'style-plate'],
      ['风格迁移全部场景', 'style-transfer'],
      ['音频制作', 'audio-production'],
      ['分析这张图片', 'image-analyze'],
    ])('classifies "%s" as execution with workflow %s', (msg, workflow) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'execution', workflow });
    });
  });

  describe('execution default (v3: everything non-browse defaults to execution)', () => {
    it('treats empty input as execution', () => {
      expect(classifyIntent({ userMessage: '' })).toEqual({ kind: 'execution' });
      expect(classifyIntent({ userMessage: '   ' })).toEqual({ kind: 'execution' });
    });

    it.each([
      'Create three scene nodes',
      'Build it out',
      'Just make it',
      'Draft something for the opening',
      'ok cool',
    ])('classifies "%s" as execution', (msg) => {
      expect(classifyIntent({ userMessage: msg })).toEqual({ kind: 'execution' });
    });

    it('questions without browse phrases default to execution', () => {
      expect(classifyIntent({ userMessage: 'What color scheme should I use?' })).toEqual({
        kind: 'execution',
      });
      expect(classifyIntent({ userMessage: 'How do I fix the aspect ratio?' })).toEqual({
        kind: 'execution',
      });
    });

    it('questions matching workflow hints get the workflow attached', () => {
      expect(classifyIntent({ userMessage: 'What is a style plate?' })).toEqual({
        kind: 'execution',
        workflow: 'style-plate',
      });
      expect(classifyIntent({ userMessage: 'How does lip sync work?' })).toEqual({
        kind: 'execution',
        workflow: 'audio-production',
      });
    });

    it('CJK non-browse messages default to execution', () => {
      expect(classifyIntent({ userMessage: '你好' })).toEqual({ kind: 'execution' });
      expect(classifyIntent({ userMessage: '创建三个场景节点' })).toEqual({ kind: 'execution' });
    });

    it('CJK workflow hints get the workflow attached', () => {
      expect(classifyIntent({ userMessage: '什么是风格板？' })).toEqual({
        kind: 'execution',
        workflow: 'style-plate',
      });
    });

    it('workflow mention without execution verb is execution with workflow', () => {
      expect(classifyIntent({ userMessage: "I've been thinking about a style plate" })).toEqual({
        kind: 'execution',
        workflow: 'style-plate',
      });
    });
  });

  describe('precedence', () => {
    it('browse phrases take priority over workflow hints', () => {
      expect(classifyIntent({ userMessage: 'list the tools I can use to create videos' })).toEqual({
        kind: 'informational',
      });
    });
  });
});
