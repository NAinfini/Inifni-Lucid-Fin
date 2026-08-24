import { describe, expect, it } from 'vitest';
import {
  createMovieProductionTaskListGraph,
  getMovieProductionTaskContract,
} from './movie.production.v2.js';

describe('movie.production.v2 Delivery blueprint', () => {
  it('creates durable tasks for every scene beyond the former 24-shot limit', () => {
    const sceneCount = 25;
    const graph = createMovieProductionTaskListGraph({
      story: {
        acts: [
          {
            scenes: Array.from({ length: sceneCount }, (_, index) => ({
              title: `Scene ${index + 1}`,
            })),
          },
        ],
      },
    });

    expect(graph.sourceSceneCount).toBe(sceneCount);
    expect(graph.shots).toHaveLength(sceneCount);
    expect(graph.shots.at(-1)).toMatchObject({ id: '025', title: 'Scene 25' });
    expect(graph).not.toHaveProperty('truncated');
    expect(graph.definition.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shot-spec-025' }),
        expect.objectContaining({ id: 'media-shot-025' }),
      ]),
    );
  });

  it('uses Ordered Delivery followed by the explicit Delivery approval producer', () => {
    const graph = createMovieProductionTaskListGraph({
      story: {
        acts: [{ scenes: [{ title: 'Arrival' }, { title: 'Signal' }] }],
      },
    });
    const assembly = graph.definition.tasks.find((task) => task.id === 'assembly');
    const delivery = graph.definition.tasks.find((task) => task.id === 'delivery');

    expect(assembly).toMatchObject({
      phaseKey: 'assembly',
      name: 'Prepare Ordered Delivery',
      phaseName: 'Ordered Delivery',
      displayLabel: 'Order source videos',
      inputBinding: { taskRole: 'assembly' },
    });
    expect(delivery).toMatchObject({
      phaseKey: 'delivery',
      phaseName: 'Delivery',
      name: 'Prepare Delivery manifest',
      dependsOnTaskIds: ['assembly'],
      inputBinding: { taskRole: 'delivery' },
    });
    expect(getMovieProductionTaskContract('assembly')?.objective).toMatch(/Ordered Delivery/);
    expect(getMovieProductionTaskContract('delivery')?.primaryTools).toEqual(['task.delivery']);
    expect(graph.definition.tasks.map((task) => task.id)).not.toContain('final-export');
  });

  it('uses AI-authored display names without changing task identity or dependencies', () => {
    const graph = createMovieProductionTaskListGraph({
      taskNames: {
        'production-plan': '梳理星际遗迹故事方案',
        'shot-spec-001': '定义遗迹入口的首个镜头',
      },
      story: { acts: [{ scenes: [{ title: '抵达遗迹' }] }] },
    });
    const plan = graph.definition.tasks.find((task) => task.id === 'production-plan');
    const shot = graph.definition.tasks.find((task) => task.id === 'shot-spec-001');

    expect(plan).toMatchObject({
      id: 'production-plan',
      name: '梳理星际遗迹故事方案',
      displayLabel: '梳理星际遗迹故事方案',
    });
    expect(plan).not.toHaveProperty('displayLabelKey');
    expect(shot).toMatchObject({
      id: 'shot-spec-001',
      name: '定义遗迹入口的首个镜头',
      displayLabel: '定义遗迹入口的首个镜头',
      dependsOnTaskIds: ['script', 'entities', 'references'],
    });
    expect(shot).not.toHaveProperty('displayLabelKey');
  });

  it('keeps locale keys only on host-authored fallback labels', () => {
    const graph = createMovieProductionTaskListGraph({
      story: { acts: [{ scenes: [{ title: 'Arrival' }] }] },
    });

    expect(graph.definition.tasks.find((task) => task.id === 'production-plan')).toMatchObject({
      displayLabelKey: 'taskLabels.productionPlan',
    });
    expect(graph.definition.tasks.find((task) => task.id === 'shot-spec-001')).toMatchObject({
      displayLabelKey: 'taskLabels.shotSpecification',
      relatedEntityLabel: '001 · Arrival',
    });
  });
});
